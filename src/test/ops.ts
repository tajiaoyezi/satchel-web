import { vi } from 'vitest'

import { adminAccount, fakeServer, type FakeCall, type FakeReply } from './server'

// opsServer 是运维页测试共用的假主控：已初始化、管理员登录着，再加上各页自己的路由。
export function opsServer(routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)>, account: object = adminAccount) {
  return fakeServer({
    'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
    'GET /api/v1/account/show': { body: account },
    ...routes,
  })
}

// page 是列表命令的一页。
export const page = (items: unknown[], nextCursor = '') => ({ body: { items, total: items.length, nextCursor } })

// query 取一次请求的查询参数。
export const query = (call: FakeCall) => new URLSearchParams(call.url.split('?')[1] ?? '')

// fakeXHR 换掉 XMLHttpRequest（上传用它），回固定的回应，记下发出的请求。
export function fakeXHR(reply: { status: number; body: unknown }) {
  const sent: { url?: string; type?: string; body?: unknown } = {}
  class FakeXHR {
    status = reply.status
    responseText = JSON.stringify(reply.body)
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
      setTimeout(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
        this.onload?.()
      }, 0)
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
  return sent
}
