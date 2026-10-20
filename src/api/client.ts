import { commands, type CommandName, type CommandRoute } from './commands'

// 网页的调用约定（web-console「只经命令表的接口」）：只调命令表里的命令与会话入口；失败时是主控的四字段错误，
// 网页原样显示 reason 与 next，不自己编说法。

export interface ErrorBody {
  code: string
  reason: string
  state: Record<string, unknown>
  next: string
}

// ApiError 是一次失败的请求：HTTP 状态与主控的四字段错误。fromMaster 为 false 时错误体不是主控给的：请求没发出去（状态 0），
// 或者回应不是四字段错误（多半是主控前面的代理回的页面），body 是网页按状态补的。
export class ApiError extends Error {
  readonly status: number
  readonly body: ErrorBody
  readonly fromMaster: boolean

  constructor(status: number, body: ErrorBody, fromMaster = true) {
    super(body.reason || body.code)
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.fromMaster = fromMaster
  }

  get code(): string {
    return this.body.code
  }
}

// isUnreachable 报告一次失败是不是「连不上主控」（web-console「长任务的跟踪」，与 CLI 的规则相同）：网络错误，或者主控前面的
// 代理回了 502、503、504、520–524，而不是主控的四字段错误。主控自己回的 503（如迁移期间的 unavailable）不算。
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.fromMaster) return false
  return error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504 || (error.status >= 520 && error.status <= 524)
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
  signal?: AbortSignal
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
  return new ApiError(res.status, { code: 'internal', reason: `HTTP ${res.status}`, state: {}, next: '' }, false)
}

// request 发一次请求：body 是对象时按 JSON 发；成功时回解析好的 JSON，失败时抛 ApiError。会话入口也用它。
// signal 中止（如超时）时与网络错误一样，是状态 0 的「连不上主控」。
export async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (e) {
    throw new ApiError(0, { code: 'unavailable', reason: e instanceof Error ? e.message : String(e), state: {}, next: '' }, false)
  }
  if (!res.ok) throw await parseError(res)
  return (await res.json()) as T
}

// postBody 是 POST 命令的 JSON 体：flag、confirm 与当场验证的两个值。
function postBody(opts: RunOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(opts.flags ?? {})) if (v !== undefined) body[k] = v
  if (opts.confirm !== undefined) body.confirm = opts.confirm
  if (opts.verify) {
    body['verify-password'] = opts.verify.password
    if (opts.verify.code) body['verify-code'] = opts.verify.code
  }
  return body
}

// run 调一条命令：GET 的 flag 走查询参数，POST 的 flag、confirm 与当场验证的两个值放进 JSON 体。
export function run<T>(name: CommandName, opts: RunOptions = {}): Promise<T> {
  const route = routeFor(name, opts.args)
  if (route.method === 'GET') {
    const page = route.list ? { limit: opts.limit, cursor: opts.cursor } : {}
    return request<T>('GET', route.url + query(opts.flags, page), undefined, opts.signal)
  }
  return request<T>('POST', route.url, postBody(opts), opts.signal)
}

// fileName 取 Content-Disposition 里的文件名（filename* 优先）；没有时为空串。
export function fileName(disposition: string | null): string {
  if (!disposition) return ''
  const star = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // 编码坏了：退回 filename
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(disposition)
  return plain ? (plain[2] ?? plain[1]).trim() : ''
}

// revokeDelayMs 是触发保存之后多久释放对象 URL。
const revokeDelayMs = 1000

// download 调一条下载类命令（POST JSON 体，带位置参数与当场验证）：成功时把回应收成 Blob，让浏览器存成文件，返回文件名与字节数；
// 文件名取 Content-Disposition，没有时用 fallbackName。整个文件先收进内存，大文件建议用 CLI（design 第 2 条）。
export async function download(name: CommandName, opts: RunOptions & { fallbackName: string }): Promise<{ name: string; size: number }> {
  const route = routeFor(name, opts.args)
  let res: Response
  try {
    res = await fetch(route.url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(postBody(opts)) })
  } catch (e) {
    throw new ApiError(0, { code: 'unavailable', reason: e instanceof Error ? e.message : String(e), state: {}, next: '' }, false)
  }
  if (!res.ok) throw await parseError(res)
  const blob = await res.blob()
  const file = fileName(res.headers.get('Content-Disposition')) || opts.fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 浏览器在 click 之后才去读这个地址：过一会儿再释放，免得保存还没开始地址就没了。
  setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs)
  return { name: file, size: blob.size }
}

// upload 调一条上传类命令：请求体是文件本身，flag 走查询参数；用 XMLHttpRequest 以便报告上传进度（0 到 1）。
// contentType 默认是 application/zip；图片用 application/octet-stream（主控按内容认定类型，不看这个头）。
export function upload<T>(
  name: CommandName,
  file: Blob,
  opts: { flags?: Record<string, FlagValue>; contentType?: string; onProgress?: (p: number) => void } = {},
): Promise<T> {
  const route = routeFor(name)
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', route.url + query(opts.flags))
    xhr.withCredentials = true
    xhr.setRequestHeader('Content-Type', opts.contentType ?? 'application/zip')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new ApiError(0, { code: 'unavailable', reason: 'network error', state: {}, next: '' }, false))
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
        e && typeof e.code === 'string'
          ? new ApiError(xhr.status, { code: e.code, reason: e.reason ?? '', state: e.state ?? {}, next: e.next ?? '' })
          : new ApiError(xhr.status, { code: 'internal', reason: `HTTP ${xhr.status}`, state: {}, next: '' }, false),
      )
    }
    xhr.send(file)
  })
}
