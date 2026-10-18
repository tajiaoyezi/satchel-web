import { vi } from 'vitest'

// fakeServer 用一张「方法 路径 → 回应」的表替掉 fetch，记下每次请求（组件与路由的测试用）。
export interface FakeReply {
  status?: number
  body: unknown
}

export interface FakeCall {
  method: string
  url: string
  body?: unknown
}

export function fakeServer(routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)>) {
  const calls: FakeCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const call: FakeCall = { method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined }
      calls.push(call)
      const key = `${call.method} ${url.split('?')[0]}`
      const route = routes[key]
      if (!route) return new Response(JSON.stringify({ code: 'not_found', reason: key, state: {}, next: '' }), { status: 404 })
      const reply = typeof route === 'function' ? route(call) : route
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 })
    }),
  )
  return calls
}

export const unauthenticated: FakeReply = { status: 401, body: { code: 'unauthenticated', reason: '没有身份', state: {}, next: '' } }

export const adminAccount = {
  username: 'admin',
  role: 'admin',
  email: '',
  nickname: '',
  totp_enabled: false,
  totp_pending: false,
  recovery_codes_remaining: 0,
  recovery_codes_low: false,
  sessions: 1,
}
