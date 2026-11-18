import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount, type FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const summary = (name: string, status: string, patch: object = {}) => ({
  id: name.length,
  name,
  connection_mode: 'websocket',
  status,
  last_heartbeat: status === 'pending' ? null : '2026-11-17T10:00:00Z',
  ip_address: status === 'pending' ? null : '203.0.113.7',
  ip_address_v6: '',
  ...patch,
})

const serverObject = (name: string) => ({
  apiVersion: 'satchel/v1',
  kind: 'Server',
  metadata: { id: 1, name },
  spec: { name, connection_mode: 'websocket' },
  status: { status: 'pending', last_heartbeat: null, ip_address: null, ip_address_v6: '', offline_since: null, boot_count: 0, core_running: false, core_version: '', core_boot_time: null, core_boot_count: 0, token: '***' },
})

// web-console「服务器页」的列表部分。
describe('服务器列表页', () => {
  it('列表与在线台数：三种状态各一台，顶部在线 1、离线 1；一次取 500 条', async () => {
    const calls = opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'connected'), summary('jp-22', 'offline'), summary('sg-333', 'pending')]) })
    renderApp('/servers')
    const hk = await screen.findByTestId('server-hk-1')
    expect(within(hk).getByText('在线')).toBeTruthy()
    expect(within(hk).getByText('203.0.113.7')).toBeTruthy()
    expect(within(screen.getByTestId('server-jp-22')).getByText('离线')).toBeTruthy()
    const sg = screen.getByTestId('server-sg-333')
    expect(within(sg).getByText('等待首次连接')).toBeTruthy()
    expect(within(sg).getByText('还没有心跳')).toBeTruthy()
    expect(screen.getByTestId('count-online').textContent).toBe('在线 1')
    expect(screen.getByTestId('count-offline').textContent).toBe('离线 1')
    expect(screen.getByText('共 3 台')).toBeTruthy()
    expect(query(calls.find((c: FakeCall) => c.url.startsWith('/api/v1/server?'))!).get('limit')).toBe('500')
    expect(hk.getAttribute('href')).toBe('/servers/hk-1')
  })

  it('不认识的状态原样显示', async () => {
    opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'draining')]) })
    renderApp('/servers')
    expect(within(await screen.findByTestId('server-hk-1')).getByText('draining')).toBeTruthy()
  })

  it('没有服务器时写明怎么添加', async () => {
    opsServer({ 'GET /api/v1/server': page([]) })
    renderApp('/servers')
    expect(await screen.findByText(/还没有服务器。点「添加服务器」/)).toBeTruthy()
  })

  it('有下一页时注明台数只算了已加载的部分', async () => {
    opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'connected')], 'next-1') })
    renderApp('/servers')
    expect(await screen.findByText('台数只算了已加载的部分')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加载更多' })).toBeTruthy()
  })

  it.each(['/servers', '/servers/hk-1'])('普通用户打开 %s 显示没有权限，不发服务器的请求', async (path) => {
    const calls = opsServer({}, { ...adminAccount, username: 'carol', role: 'user' })
    renderApp(path)
    expect(await screen.findByText('没有权限')).toBeTruthy()
    expect(calls.some((c: FakeCall) => c.url.startsWith('/api/v1/server'))).toBe(false)
  })

  it('添加服务器：只发名字，成功后进入详情页', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/server': page([]),
      'POST /api/v1/server/add/hk-1': { body: serverObject('hk-1') },
      'GET /api/v1/server/get/hk-1': { body: serverObject('hk-1') },
    })
    const { router } = renderApp('/servers')
    await user.click(await screen.findByRole('button', { name: '添加服务器' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('名字'), ' hk-1 ')
    await user.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/servers/hk-1'))
    const add = calls.find((c: FakeCall) => c.method === 'POST' && c.url === '/api/v1/server/add/hk-1')
    expect(add?.body).toEqual({ mode: 'auto' })
    expect(await screen.findByRole('heading', { name: 'hk-1' })).toBeTruthy()
  })

  it('pull 模式填轮询地址：只发填了的参数，端口按数字发', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/server': page([]),
      'POST /api/v1/server/add/hk-2': { body: serverObject('hk-2') },
      'GET /api/v1/server/get/hk-2': { body: serverObject('hk-2') },
    })
    const { router } = renderApp('/servers')
    await user.click(await screen.findByRole('button', { name: '添加服务器' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('名字'), 'hk-2')
    await user.click(within(dialog).getByRole('combobox', { name: '连接模式' }))
    await user.click(await screen.findByRole('option', { name: 'pull' }))
    expect(within(dialog).getByText(/至少要填一个地址/)).toBeTruthy()
    await user.type(within(dialog).getByLabelText('轮询地址（IPv4 或主机名）'), ' 203.0.113.9 ')
    await user.type(within(dialog).getByLabelText('轮询端口'), '24000')
    await user.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/servers/hk-2'))
    expect(calls.find((c: FakeCall) => c.method === 'POST' && c.url === '/api/v1/server/add/hk-2')?.body).toEqual({ mode: 'pull', 'pull-address': '203.0.113.9', 'pull-port': 24000 })
  })

  it('websocket 模式不显示寻址参数，请求体只有 mode', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/server': page([]),
      'POST /api/v1/server/add/hk-3': { body: serverObject('hk-3') },
      'GET /api/v1/server/get/hk-3': { body: serverObject('hk-3') },
    })
    renderApp('/servers')
    await user.click(await screen.findByRole('button', { name: '添加服务器' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('管理端口')).toBeTruthy() // auto 下有寻址参数
    await user.type(within(dialog).getByLabelText('管理入口域名或 IPv4'), 'node.example.com') // 切到 websocket 后不应当发出去
    await user.type(within(dialog).getByLabelText('名字'), 'hk-3')
    await user.click(within(dialog).getByRole('combobox', { name: '连接模式' }))
    await user.click(await screen.findByRole('option', { name: 'websocket' }))
    expect(within(dialog).queryByLabelText('管理端口')).toBeNull()
    expect(within(dialog).queryByLabelText('轮询地址（IPv4 或主机名）')).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: '添加' }))
    await waitFor(() => expect(calls.some((c: FakeCall) => c.url === '/api/v1/server/add/hk-3')).toBe(true))
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/server/add/hk-3')?.body).toEqual({ mode: 'websocket' })
  })

  it('名字不合规：对话框里显示主控的 reason，留在列表页', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/server': page([]),
      'POST /api/v1/server/add/a%20b': { status: 400, body: { code: 'bad_request', reason: '服务器名只能用字母、数字与连字符', state: {}, next: '' } },
    })
    const { router } = renderApp('/servers')
    await user.click(await screen.findByRole('button', { name: '添加服务器' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('名字'), 'a b')
    await user.click(within(dialog).getByRole('button', { name: '添加' }))
    expect(await within(dialog).findByText('服务器名只能用字母、数字与连字符')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/servers')
  })
})
