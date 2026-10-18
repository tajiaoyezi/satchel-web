import { describe, expect, it, vi } from 'vitest'

import { ApiError } from './client'
import { createQueryClient } from './query'

const unauthenticated = new ApiError(401, { code: 'unauthenticated', reason: '没有身份', state: {}, next: '' })
const forbidden = new ApiError(403, { code: 'forbidden', reason: '没有权限', state: {}, next: '' })

// web-console「会话与跳转」：任何请求返回 unauthenticated 时回登录页；登录页自己的请求不跳。
describe('createQueryClient', () => {
  it('unauthenticated 时跳登录页，别的错误与登录页自己的请求不跳', async () => {
    const onUnauth = vi.fn()
    const qc = createQueryClient(onUnauth)
    await qc.fetchQuery({ queryKey: ['a'], queryFn: () => Promise.reject(unauthenticated) }).catch(() => {})
    expect(onUnauth).toHaveBeenCalledTimes(1)
    await qc.fetchQuery({ queryKey: ['b'], queryFn: () => Promise.reject(forbidden) }).catch(() => {})
    expect(onUnauth).toHaveBeenCalledTimes(1)
    const m = qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(unauthenticated), meta: { skipAuthRedirect: true } })
    await m.execute(undefined).catch(() => {})
    expect(onUnauth).toHaveBeenCalledTimes(1)
    const m2 = qc.getMutationCache().build(qc, { mutationFn: () => Promise.reject(unauthenticated) })
    await m2.execute(undefined).catch(() => {})
    expect(onUnauth).toHaveBeenCalledTimes(2)
  })
})
