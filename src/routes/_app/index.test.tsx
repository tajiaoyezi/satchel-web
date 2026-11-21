import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'
import { adminAccount, fakeServer } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const empty = { items: [], total: 0 }

const overviewServer = (servers: object, account: object = adminAccount) =>
  fakeServer({
    'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
    'GET /api/v1/account/show': { body: account },
    'GET /api/v1/overview': { body: { servers, users: empty, alerts: empty, tasks: empty } },
    'GET /api/v1/server/get/hk-1': { status: 404, body: { code: 'not_found', reason: '没有这台服务器', state: {}, next: '' } },
  })

const summary = (name: string, status: string, ip: string | null, speed: object = {}) => ({
  id: name.length,
  name,
  connection_mode: 'auto',
  status,
  last_heartbeat: null,
  ip_address: ip,
  ip_address_v6: '',
  ...speed,
})

// web-console「总览首页」。
describe('总览首页', () => {
  it('M1 的首页：服务器分区写着还没有服务器、去服务器页添加；另外三个分区写着随哪一站出现', async () => {
    overviewServer(empty)
    renderApp('/')
    const servers = await screen.findByTestId('partition-servers')
    await within(servers).findByText('0')
    expect(within(servers).getByText('服务器')).toBeTruthy()
    expect(await within(servers).findByText(/还没有服务器。/)).toBeTruthy()
    expect(within(servers).getByRole('link', { name: '去服务器页添加' }).getAttribute('href')).toBe('/servers')
    expect(within(screen.getByTestId('partition-users')).getByText('这一块随 M3 出现')).toBeTruthy()
    expect(within(screen.getByTestId('partition-alerts')).getByText('这一块随 M4 出现')).toBeTruthy()
    expect(within(screen.getByTestId('partition-tasks')).getByText('这一块随 M4 出现')).toBeTruthy()
  })

  it('服务器分区列出服务器：名字进详情页，多于列出的条数时有查看全部', async () => {
    const user = userEvent.setup()
    overviewServer({
      items: [summary('hk-1', 'connected', '203.0.113.7', { current_upload_speed: 2048, current_download_speed: 1024 * 1024 }), summary('jp-2', 'pending', null)],
      total: 12,
    })
    const { router } = renderApp('/')
    const servers = await screen.findByTestId('partition-servers')
    await within(servers).findByText('12')
    expect(within(servers).getByText('在线')).toBeTruthy()
    expect(within(servers).getByText('等待首次连接')).toBeTruthy()
    expect(within(servers).getByText('203.0.113.7')).toBeTruthy()
    expect(within(servers).getByText('无地址')).toBeTruthy()
    expect(within(servers).getByTestId('overview-speed-hk-1').textContent).toBe('↑ 2.0 KB/s ↓ 1.0 MB/s')
    expect(within(servers).getByTestId('overview-speed-jp-2').textContent).toBe('↑ 0 B/s ↓ 0 B/s')
    expect(within(servers).getByRole('link', { name: '查看全部 12 台' }).getAttribute('href')).toBe('/servers')
    expect(within(servers).queryByText(/还没有服务器/)).toBeNull()
    await user.click(within(servers).getByRole('link', { name: 'hk-1' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/servers/hk-1'))
  })

  it('条数没有多出时不显示查看全部', async () => {
    overviewServer({ items: [summary('hk-1', 'connected', '203.0.113.7')], total: 1 })
    renderApp('/')
    const servers = await screen.findByTestId('partition-servers')
    await within(servers).findByRole('link', { name: 'hk-1' })
    expect(within(servers).queryByRole('link', { name: /查看全部/ })).toBeNull()
  })

  it('普通用户的服务器分区：写着只对管理员显示，没有去添加的入口', async () => {
    overviewServer(empty, { ...adminAccount, username: 'carol', role: 'user' })
    renderApp('/')
    const servers = await screen.findByTestId('partition-servers')
    expect(await within(servers).findByText('服务器只对管理员显示。')).toBeTruthy()
    expect(within(servers).queryByRole('link', { name: '去服务器页添加' })).toBeNull()
  })
})
