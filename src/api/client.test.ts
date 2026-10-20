import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, download, fileName, isUnreachable, request, routeFor, run, upload } from './client'

interface Call {
  url: string
  method: string
  body?: unknown
}

// mockFetch 让 fetch 回一个固定的回应，记下每次的请求。
function mockFetch(status: number, body: unknown) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

// web-console「只经命令表的接口」与 design 第 7 条的请求形状。
describe('run', () => {
  it('GET：flag 走查询参数，strings 重复给，列表命令带 limit 与 cursor', async () => {
    const calls = mockFetch(200, { items: [], total: 0 })
    await run('token list', { flags: { owner: 'alice', missing: undefined }, limit: 20, cursor: 'c1' })
    expect(calls[0]).toEqual({ url: '/api/v1/token?owner=alice&limit=20&cursor=c1', method: 'GET', body: undefined })
    expect(routeFor('settings update-cdn set', ['false']).url).toBe('/api/v1/settings/update-cdn/set/false')
  })

  it('POST：位置参数进路径，flag、confirm 与当场验证进 JSON 体', async () => {
    const calls = mockFetch(200, { id: 3 })
    await run('token update', { args: ['3'], flags: { name: 'ops', danger: ['master'], secrets: true }, verify: { password: 'pw', code: '123456' } })
    expect(calls[0]).toEqual({
      url: '/api/v1/token/update/3',
      method: 'POST',
      body: { name: 'ops', danger: ['master'], secrets: true, 'verify-password': 'pw', 'verify-code': '123456' },
    })
    await run('settings update-cdn set', { args: ['false'], flags: { 'resource-version': 4 }, confirm: 'false' })
    expect(calls[1].body).toEqual({ 'resource-version': 4, confirm: 'false' })
  })

  it('没开两步验证时不带 verify-code', async () => {
    const calls = mockFetch(200, {})
    await run('token revoke', { args: ['7'], verify: { password: 'pw' } })
    expect(calls[0].body).toEqual({ 'verify-password': 'pw' })
  })

  it('失败时抛出主控的四字段错误', async () => {
    mockFetch(409, { code: 'version_conflict', reason: '别人改过', state: { resourceVersion: 5 }, next: '重新读取' })
    const err = await run('settings set', { flags: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe('version_conflict')
    expect((err as ApiError).body).toEqual({ code: 'version_conflict', reason: '别人改过', state: { resourceVersion: 5 }, next: '重新读取' })
  })

  it('回应不是 JSON 时给出 HTTP 状态', async () => {
    mockFetch(502, '<html>bad gateway</html>')
    const err = (await request('GET', '/api/v1/overview').catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('internal')
    expect(err.status).toBe(502)
  })
})

// 上传：请求体是文件本身，flag 走查询参数，报告进度。
describe('upload', () => {
  it('发文件并报告进度', async () => {
    const sent: { url?: string; body?: unknown; type?: string } = {}
    class FakeXHR {
      status = 200
      responseText = '{"ok":true}'
      upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
      onload?: () => void
      onerror?: () => void
      withCredentials = false
      open(_m: string, url: string) {
        sent.url = url
      }
      setRequestHeader(_k: string, v: string) {
        sent.type = v
      }
      send(body: unknown) {
        sent.body = body
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const progress: number[] = []
    const file = new Blob(['zip'])
    const res = await upload<{ ok: boolean }>('setup restore', file, { onProgress: (p) => progress.push(p) })
    expect(res).toEqual({ ok: true })
    expect(sent).toEqual({ url: '/api/v1/setup/restore', body: file, type: 'application/zip' })
    expect(progress).toEqual([0.5])
  })

  it('可以指定 Content-Type；失败时是四字段错误', async () => {
    const sent: { type?: string } = {}
    class FakeXHR {
      status = 400
      responseText = '{"code":"bad_request","reason":"只收 PNG、JPEG、GIF、WebP 与 ICO 图片","state":{},"next":""}'
      upload = {}
      onload?: () => void
      withCredentials = false
      open() {}
      setRequestHeader(_k: string, v: string) {
        sent.type = v
      }
      send() {
        this.onload?.()
      }
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR)
    const err = (await upload('settings image upload', new Blob(['<svg/>']), { contentType: 'application/octet-stream' }).catch((e: unknown) => e)) as ApiError
    expect(sent.type).toBe('application/octet-stream')
    expect(err.code).toBe('bad_request')
    expect(err.fromMaster).toBe(true)
  })
})

// 下载类命令：POST JSON 体（位置参数进路径、当场验证进体），收成 Blob 让浏览器保存（design 第 2 条）。
describe('download', () => {
  it('请求形状、文件名取 Content-Disposition，对象 URL 用完释放', async () => {
    vi.useFakeTimers()
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET', body: JSON.parse(String(init.body)) })
        return new Response('PKzip', { status: 200, headers: { 'Content-Disposition': 'attachment; filename=satchel-backup-1.zip' } })
      }),
    )
    const created: Blob[] = []
    const revoked: string[] = []
    vi.stubGlobal('URL', { ...URL, createObjectURL: (b: Blob) => (created.push(b), 'blob:1'), revokeObjectURL: (u: string) => revoked.push(u) })
    const clicked: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download)
    })
    try {
      const res = await download('backup download', { args: ['b 1.zip'], verify: { password: 'pw' }, fallbackName: 'b 1.zip' })
      expect(calls[0]).toEqual({ url: '/api/v1/backup/download/b%201.zip', method: 'POST', body: { 'verify-password': 'pw' } })
      expect(res).toEqual({ name: 'satchel-backup-1.zip', size: 5 })
      expect(clicked).toEqual(['satchel-backup-1.zip'])
      expect(created).toHaveLength(1)
      expect(revoked).toEqual([])
      vi.runAllTimers()
      expect(revoked).toEqual(['blob:1'])
    } finally {
      click.mockRestore()
      vi.useRealTimers()
    }
  })

  it('失败时抛出四字段错误，不保存', async () => {
    mockFetch(403, { code: 'human_required', reason: '要当场验证', state: {}, next: '' })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
    const err = (await download('backup download', { args: ['x.zip'], fallbackName: 'x.zip' }).catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe('human_required')
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('文件名：filename* 优先，带引号的也认，没有时为空', () => {
    expect(fileName(`attachment; filename="a b.zip"`)).toBe('a b.zip')
    expect(fileName(`attachment; filename=x.zip; filename*=utf-8''%E5%A4%87%E4%BB%BD.zip`)).toBe('备份.zip')
    expect(fileName('attachment')).toBe('')
    expect(fileName(null)).toBe('')
  })
})

// web-console「长任务的跟踪」的「连不上」：网络错误与代理的网关类状态码算，主控的四字段错误不算。
describe('isUnreachable', () => {
  it('状态 0、非主控的 502 与 520 算连不上，主控的 503 不算', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const network = await run('job get', { args: ['job-1'] }).catch((e: unknown) => e)
    expect((network as ApiError).status).toBe(0)
    expect(isUnreachable(network)).toBe(true)
    mockFetch(502, '<html>bad gateway</html>')
    expect(isUnreachable(await run('job get', { args: ['job-1'] }).catch((e: unknown) => e))).toBe(true)
    mockFetch(520, '')
    expect(isUnreachable(await run('job get', { args: ['job-1'] }).catch((e: unknown) => e))).toBe(true)
    mockFetch(503, { code: 'unavailable', reason: '正在迁移', state: {}, next: '' })
    expect(isUnreachable(await run('job get', { args: ['job-1'] }).catch((e: unknown) => e))).toBe(false)
    mockFetch(500, '<html>oops</html>')
    expect(isUnreachable(await run('job get', { args: ['job-1'] }).catch((e: unknown) => e))).toBe(false)
  })
})
