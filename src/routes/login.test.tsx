import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'
import { adminAccount, fakeServer, type FakeReply } from '@/test/server'

const initialized = { body: { initialized: true, paths: {} } }
const noCaptcha = { body: { enabled: false, site_key: '' } }

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.turnstile
})

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('用户名'), 'admin')
  await user.type(screen.getByLabelText('密码'), 'secret12')
  await user.click(screen.getByRole('button', { name: '登录' }))
}

// web-console「登录页」的组件部分。
describe('登录页', () => {
  it('两步登录：先转到第二步，提交后回到原来要去的页面', async () => {
    const user = userEvent.setup()
    const calls = fakeServer({
      'GET /api/v1/setup/status': initialized,
      'GET /api/v1/session/captcha': noCaptcha,
      'POST /api/v1/session': { body: { two_factor_required: true, pending: 'p1' } },
      'POST /api/v1/session/two-factor': { body: { username: 'admin', role: 'admin' } },
      'GET /api/v1/account/show': { body: adminAccount },
    })
    const { router } = renderApp('/login?redirect=%2Ftokens')
    await fillAndSubmit(user)
    await user.type(await screen.findByLabelText('验证码或恢复码'), '123456')
    await user.click(screen.getByRole('button', { name: '验证' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/tokens'))
    expect(calls.find((c) => c.url === '/api/v1/session')?.body).toEqual({ username: 'admin', password: 'secret12', remember_me: false })
    expect(calls.find((c) => c.url === '/api/v1/session/two-factor')?.body).toEqual({ pending: 'p1', code: '123456' })
  })

  it('第二步验错一次就回到用户名与密码', async () => {
    const user = userEvent.setup()
    fakeServer({
      'GET /api/v1/setup/status': initialized,
      'GET /api/v1/session/captcha': noCaptcha,
      'POST /api/v1/session': { body: { two_factor_required: true, pending: 'p1' } },
      'POST /api/v1/session/two-factor': { status: 401, body: { code: 'unauthenticated', reason: '验证码不对，请重新登录', state: {}, next: '' } },
    })
    renderApp('/login')
    await fillAndSubmit(user)
    await user.type(await screen.findByLabelText('验证码或恢复码'), '000000')
    await user.click(screen.getByRole('button', { name: '验证' }))
    expect(await screen.findByText('验证码不对，请重新登录')).toBeTruthy()
    expect(screen.getByLabelText('用户名')).toBeTruthy()
  })

  it('被限流时显示主控的 reason 与解锁时间', async () => {
    const user = userEvent.setup()
    const until = '2026-10-05T03:00:00Z'
    const limited: FakeReply = { status: 429, body: { code: 'rate_limited', reason: '尝试太多次，暂时锁定', state: { until }, next: '' } }
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/session/captcha': noCaptcha, 'POST /api/v1/session': limited })
    renderApp('/login')
    await fillAndSubmit(user)
    expect(await screen.findByText('尝试太多次，暂时锁定')).toBeTruthy()
    expect(screen.getByText(`解锁时间：${new Date(until).toLocaleString()}`)).toBeTruthy()
  })

  it('Turnstile 启用时显示组件，登录请求带 turnstile_token', async () => {
    const user = userEvent.setup()
    window.turnstile = {
      render: (_el: HTMLElement, opts: Record<string, unknown>) => {
        setTimeout(() => (opts.callback as (t: string) => void)('tok-1'), 0)
        return 'w1'
      },
      remove: () => {},
    }
    const calls = fakeServer({
      'GET /api/v1/setup/status': initialized,
      'GET /api/v1/session/captcha': { body: { enabled: true, site_key: '1x00000000000000000000AA' } },
      'POST /api/v1/session': { body: { username: 'admin', role: 'admin' } },
      'GET /api/v1/account/show': { body: adminAccount },
    })
    const { router } = renderApp('/login')
    expect(await screen.findByTestId('turnstile')).toBeTruthy()
    await fillAndSubmit(user)
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(calls.find((c) => c.url === '/api/v1/session')?.body).toMatchObject({ turnstile_token: 'tok-1' })
  })
})
