import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const verifyAs = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('密码'), 'secret12')
  await user.click(screen.getByRole('button', { name: '确认' }))
}

// web-console「安全页」的组件部分：封禁与解封都要当场验证；主控拒绝时原样显示。
describe('安全页', () => {
  it('封禁与解封：当场验证后列表里有它、再解封后没有；安全事件多了两条', async () => {
    const user = userEvent.setup()
    const bans: object[] = []
    const events: object[] = []
    const ev = (id: number, kind: string) => ({ id, at: '2026-10-18T00:00:00Z', ip: '198.51.100.7', kind, path: '', username: '', detail: '', actor: 'admin' })
    const calls = opsServer({
      'GET /api/v1/security/bans': () => page(bans),
      'GET /api/v1/security/events': () => page(events),
      'POST /api/v1/security/ban/198.51.100.7': () => {
        bans.push({ ip: '198.51.100.7', reason: 'manual', banned_at: '2026-10-18T00:00:00Z', expires_at: null, permanent: true, fail_count: 0, actor: 'admin' })
        events.unshift(ev(1, 'ban_manual'))
        return { body: bans[0] }
      },
      'POST /api/v1/security/unban/198.51.100.7': () => {
        bans.length = 0
        events.unshift(ev(2, 'unban'))
        return { body: { ip: '198.51.100.7', unbanned: true } }
      },
    })
    renderApp('/security')
    expect(await screen.findByText('没有生效中的封禁')).toBeTruthy()
    expect(screen.getByText(/封禁只拦带令牌的请求/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '封禁一个 IP' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/IP 地址/), '198.51.100.7')
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: '封禁' }))
    await verifyAs(user)
    const row = await screen.findByTestId('ban-198.51.100.7')
    expect(within(row).getByText('永久')).toBeTruthy()
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/security/ban/198.51.100.7')?.body).toEqual({ permanent: true, 'verify-password': 'secret12' })
    await user.click(within(row).getByRole('button', { name: '解封' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await verifyAs(user)
    await waitFor(() => expect(screen.queryByTestId('ban-198.51.100.7')).toBeNull())
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/security/unban/198.51.100.7')?.body).toEqual({ 'verify-password': 'secret12' })
    await user.click(screen.getByRole('tab', { name: '安全事件' }))
    expect(await screen.findByTestId('event-2')).toHaveTextContent('解封')
    expect(screen.getByTestId('event-1')).toHaveTextContent('手动封禁')
  })

  it('填的不是 IP：请求带当场验证，显示主控的 bad_request，列表不变', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/security/bans': page([]),
      'POST /api/v1/security/ban/not-an-ip': { status: 400, body: { code: 'bad_request', reason: '"not-an-ip" 不是一个 IP 地址', state: {}, next: '' } },
    })
    renderApp('/security')
    await user.click(await screen.findByRole('button', { name: '封禁一个 IP' }))
    await user.type(within(await screen.findByRole('dialog')).getByLabelText(/IP 地址/), 'not-an-ip')
    await user.click(screen.getByRole('button', { name: '封禁' }))
    await verifyAs(user)
    expect(await screen.findByText('"not-an-ip" 不是一个 IP 地址')).toBeTruthy()
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/security/ban/not-an-ip')?.body).toEqual({ permanent: false, 'verify-password': 'secret12' })
    expect(calls.filter((c: FakeCall) => c.url.startsWith('/api/v1/security/bans'))).toHaveLength(1)
  })
})
