import { commands, type CommandName, type CommandRoute } from './commands'

// 网页的调用约定（web-console「只经命令表的接口」）：只调命令表里的命令与会话入口；失败时是主控的四字段错误，
// 网页原样显示 reason 与 next，不自己编说法。

export interface ErrorBody {
  code: string
  reason: string
  state: Record<string, unknown>
  next: string
}

// ApiError 是一次失败的请求：HTTP 状态与主控的四字段错误。
export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorBody

  constructor(status: number, body: ErrorBody) {
    super(body.reason || body.code)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }

  get code(): string {
    return this.body.code
  }
}

export type FlagValue = string | number | boolean | string[] | Record<string, unknown> | null | undefined

// Verification 是人类专属命令的当场验证（master-human-verification）：自己的密码，开了两步验证时还有验证码或恢复码。
export interface Verification {
  password: string
  code?: string
}

export interface RunOptions {
  args?: string[]
  flags?: Record<string, FlagValue>
  confirm?: string
  verify?: Verification
  limit?: number
  cursor?: string
}

// routeFor 把命令的路径模板填上位置参数（依次替换 {名字}）。
export function routeFor(name: CommandName, args: string[] = []): CommandRoute & { url: string } {
  const route: CommandRoute = commands[name]
  let i = 0
  const url = route.path.replace(/\{[^}]+\}/g, () => encodeURIComponent(args[i++] ?? ''))
  return { ...route, url }
}

function query(flags: Record<string, FlagValue> = {}, extra: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(flags)) {
    if (v === undefined || v === null) continue
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x))
    else if (typeof v === 'object') throw new Error(`flag ${k} is an object and cannot go into a query string`)
    else q.append(k, String(v))
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') q.append(k, String(v))
  const s = q.toString()
  return s ? `?${s}` : ''
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ErrorBody>
    if (typeof body.code === 'string') {
      return new ApiError(res.status, { code: body.code, reason: body.reason ?? '', state: body.state ?? {}, next: body.next ?? '' })
    }
  } catch {
    // 不是 JSON：多半是反代或网络中间件回的页面
  }
  return new ApiError(res.status, { code: 'internal', reason: `HTTP ${res.status}`, state: {}, next: '' })
}

// request 发一次请求：body 是对象时按 JSON 发；成功时回解析好的 JSON，失败时抛 ApiError。会话入口也用它。
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(0, { code: 'unavailable', reason: e instanceof Error ? e.message : String(e), state: {}, next: '' })
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

// run 调一条命令：GET 的 flag 走查询参数，POST 的 flag、confirm 与当场验证的两个值放进 JSON 体。
export function run<T>(name: CommandName, opts: RunOptions = {}): Promise<T> {
  const route = routeFor(name, opts.args)
  if (route.method === 'GET') {
    const page = route.list ? { limit: opts.limit, cursor: opts.cursor } : {}
    return request<T>('GET', route.url + query(opts.flags, page))
  }
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(opts.flags ?? {})) if (v !== undefined) body[k] = v
  if (opts.confirm !== undefined) body.confirm = opts.confirm
  if (opts.verify) {
    body['verify-password'] = opts.verify.password
    if (opts.verify.code) body['verify-code'] = opts.verify.code
  }
  return request<T>('POST', route.url, body)
}

// upload 调一条上传类命令：请求体是文件本身，flag 走查询参数；用 XMLHttpRequest 以便报告上传进度（0 到 1）。
export function upload<T>(name: CommandName, file: Blob, opts: { flags?: Record<string, FlagValue>; onProgress?: (p: number) => void } = {}): Promise<T> {
  const route = routeFor(name)
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', route.url + query(opts.flags))
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', 'application/zip')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new ApiError(0, { code: 'unavailable', reason: 'network error', state: {}, next: '' }))
    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = null // 不是 JSON：多半是反代回的页面
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T)
      const e = body as Partial<ErrorBody> | null
      reject(
        new ApiError(xhr.status, e && typeof e.code === 'string' ? { code: e.code, reason: e.reason ?? '', state: e.state ?? {}, next: e.next ?? '' } : { code: 'internal', reason: `HTTP ${xhr.status}`, state: {}, next: '' }),
      )
    }
    xhr.send(file)
  })
}
