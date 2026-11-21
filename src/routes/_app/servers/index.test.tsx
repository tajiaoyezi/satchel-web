import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount, type FakeCall } from '@/test/server'
import { dashboardFrame, dashboardServer, FakeWebSocket } from '@/test/websocket'

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

const item = (server: string, patch: object = {}) => ({
  server,
  channel: 'stable',
  current_version: '0.1.0',
  latest_version: '0.2.0',
  has_update: true,
  in_docker: false,
  reachable: true,
  compatible: true,
  can_apply: true,
  ...patch,
})

const checkAll = {
  body: {
    channel: 'stable',
    latest_version: '0.2.0',
    total: 3,
    items: [item('hk-1'), item('jp-2'), item('us-3', { in_docker: true, can_apply: false, reason: 'Docker 容器内不支持自更新，请更换镜像 tag 后重建容器' })],
  },
}

const batchJob = (patch: object = {}) => ({
  body: { job_id: 'job-b', kind: 'server update batch', status: 'queued', created_at: '2026-11-18T10:00:00Z', started_at: null, finished_at: null, exit_code: null, output: null, output_truncated: false, ...patch },
})

async function openBatch(routes: Parameters<typeof opsServer>[0]) {
  const calls = opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'connected')]), 'GET /api/v1/server/update/check': checkAll, ...routes })
  const user = userEvent.setup()
  renderApp('/servers')
  await user.click(await screen.findByRole('button', { name: '批量升级' }))
  const dialog = within(await screen.findByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: '检查全部' }))
  await dialog.findByTestId('batch-check')
  return { calls, user, dialog }
}

// web-console「服务器页」的批量升级（m2-10）。
describe('服务器列表页：批量升级', () => {
  it('检查全部不带名字；能升级的默认勾上，不能升级的不能勾并写原因；确认值是台数，请求带 servers、channel 与 confirm', async () => {
    const { calls, user, dialog } = await openBatch({ 'POST /api/v1/server/update/batch/0.2.0': batchJob(), 'GET /api/v1/job/get/job-b': batchJob({ status: 'running' }) })
    const checkCall = calls.find((c) => c.url.startsWith('/api/v1/server/update/check'))!
    expect(checkCall.url.split('?')[0]).toBe('/api/v1/server/update/check')
    expect(query(checkCall).get('channel')).toBe('stable')
    expect(dialog.getByRole('checkbox', { name: '选择 hk-1' }).getAttribute('data-state')).toBe('checked')
    expect(dialog.getByRole('checkbox', { name: '选择 jp-2' }).getAttribute('data-state')).toBe('checked')
    expect(dialog.getByRole('checkbox', { name: '选择 us-3' }).hasAttribute('disabled')).toBe(true)
    expect(dialog.getByText('不能：Docker 容器内不支持自更新，请更换镜像 tag 后重建容器')).toBeTruthy()
    await user.click(dialog.getByRole('button', { name: '升级所选的 2 台到 0.2.0' }))
    expect(await screen.findByText('要确认的值：2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/server/update/batch/0.2.0')?.body).toEqual({ servers: ['hk-1', 'jp-2'], channel: 'stable', confirm: '2' }),
    )
    expect(await dialog.findByText(/关掉这个对话框不会取消升级/)).toBeTruthy()
  })

  it('一台都不勾时「升级所选」不可用；取消勾选会改变台数', async () => {
    const { user, dialog } = await openBatch({})
    await user.click(dialog.getByRole('checkbox', { name: '选择 jp-2' }))
    expect(dialog.getByRole('button', { name: '升级所选的 1 台到 0.2.0' })).toBeTruthy()
    await user.click(dialog.getByRole('checkbox', { name: '选择 hk-1' }))
    expect(dialog.getByRole('button', { name: '升级所选的 0 台到 0.2.0' }).hasAttribute('disabled')).toBe(true)
  })

  it('批量升级成功：逐台列出结果与汇总', async () => {
    const output = JSON.stringify({
      version: '0.2.0',
      channel: 'stable',
      total: 2,
      succeeded: 2,
      failed: 0,
      aborted: 0,
      results: [
        { server: 'hk-1', from_version: '0.1.0', to_version: '0.2.0', status: 'done' },
        { server: 'jp-2', from_version: '0.1.0', to_version: '0.2.0', status: 'done' },
      ],
    })
    const { user, dialog } = await openBatch({ 'POST /api/v1/server/update/batch/0.2.0': batchJob(), 'GET /api/v1/job/get/job-b': batchJob({ status: 'done', output }) })
    await user.click(dialog.getByRole('button', { name: '升级所选的 2 台到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await dialog.findByText('成功 2 台，失败 0 台，中止 0 台', {}, { timeout: 4000 })).toBeTruthy()
    expect(within(dialog.getByTestId('update-result-hk-1')).getByText('成功')).toBeTruthy()
    expect(within(dialog.getByTestId('update-result-jp-2')).getByText('0.1.0 → 0.2.0')).toBeTruthy()
  })

  it('名字带逗号的服务器照常能勾，名字原样作为数组的一项发出', async () => {
    const { calls, user, dialog } = await openBatch({
      'GET /api/v1/server/update/check': { body: { channel: 'stable', latest_version: '0.2.0', total: 2, items: [item('hk-1'), item('a,b')] } },
      'POST /api/v1/server/update/batch/0.2.0': batchJob(),
      'GET /api/v1/job/get/job-b': batchJob({ status: 'running' }),
    })
    const comma = dialog.getByRole('checkbox', { name: '选择 a,b' })
    expect(comma.hasAttribute('disabled')).toBe(false)
    expect(comma.getAttribute('data-state')).toBe('checked')
    await user.click(dialog.getByRole('button', { name: '升级所选的 2 台到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/server/update/batch/0.2.0')?.body).toEqual({ servers: ['hk-1', 'a,b'], channel: 'stable', confirm: '2' }),
    )
  })

  it('批量升级中途中止：显示 reason，逐台列出失败与中止的原因和磁盘状态', async () => {
    const output = JSON.stringify({
      code: 'conflict',
      reason: '节点 hk-1 出现高危确认失败，已中止后续 1 台（成功 0 台）',
      state: {
        version: '0.2.0',
        total: 2,
        succeeded: 0,
        failed: 1,
        aborted: 1,
        results: [
          { server: 'hk-1', from_version: '0.1.0', to_version: '0.2.0', status: 'failed', disk_state: 'new_unconfirmed', retryable: false, reason: '节点替换后未在确认窗内恢复' },
          { server: 'jp-2', from_version: '0.1.0', to_version: '0.2.0', status: 'aborted', reason: '前面节点 hk-1 出现高危确认失败（new_unconfirmed），批量升级已中止' },
        ],
      },
      next: '',
    })
    const { user, dialog } = await openBatch({ 'POST /api/v1/server/update/batch/0.2.0': batchJob(), 'GET /api/v1/job/get/job-b': batchJob({ status: 'failed', output }) })
    await user.click(dialog.getByRole('button', { name: '升级所选的 2 台到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await dialog.findByText('节点 hk-1 出现高危确认失败，已中止后续 1 台（成功 0 台）', {}, { timeout: 4000 })).toBeTruthy()
    const hk = within(dialog.getByTestId('update-result-hk-1'))
    expect(hk.getByText('失败')).toBeTruthy()
    expect(hk.getByText('节点替换后未在确认窗内恢复')).toBeTruthy()
    expect(hk.getByText('新版本未确认')).toBeTruthy()
    const jp = within(dialog.getByTestId('update-result-jp-2'))
    expect(jp.getByText('中止')).toBeTruthy()
    expect(jp.getByText(/批量升级已中止/)).toBeTruthy()
    expect(dialog.getByText('成功 0 台，失败 1 台，中止 1 台')).toBeTruthy()
  })
})

// web-console「服务器页」列表页的实时推送（m2-14）。
describe('服务器列表页：实时推送', () => {
  const lists = (calls: FakeCall[]) => calls.filter((c) => c.url.split('?')[0] === '/api/v1/server').length

  it('推送连上后按帧显示卡片、台数与总网速，写明实时推送，不再定时请求 server list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const calls = opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'pending')]) })
      renderApp('/servers')
      await screen.findByTestId('server-hk-1')
      expect(screen.getByTestId('feed-mode').textContent).toBe('定时刷新（每 10 秒）')
      act(() => FakeWebSocket.latest().push(dashboardFrame([dashboardServer('hk-1', { current_upload_speed: 2048, current_download_speed: 1024 * 1024 })])))
      expect(screen.getByTestId('feed-mode').textContent).toBe('实时推送')
      expect(within(screen.getByTestId('server-hk-1')).getByText('在线')).toBeTruthy()
      expect(screen.getByTestId('speed-hk-1').textContent).toBe('↑ 2.0 KB/s ↓ 1.0 MB/s')
      expect(screen.getByTestId('count-online').textContent).toBe('在线 1')
      expect(screen.getByTestId('total-speed').textContent).toBe('总计 ↑ 2.0 KB/s ↓ 1.0 MB/s')
      const before = lists(calls)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_000) // 大于 10 秒的刷新间隔，小于 15 秒的推送超时
      })
      expect(lists(calls)).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('推送断开：马上重新请求 server list，新结果回来之前继续显示最后一帧；之后每 10 秒请求，并在稍后重连推送', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let reply = page([summary('hk-1', 'pending')])
      const calls = opsServer({ 'GET /api/v1/server': () => reply })
      renderApp('/servers')
      await screen.findByTestId('server-hk-1')
      act(() => FakeWebSocket.latest().push(dashboardFrame([dashboardServer('hk-1'), dashboardServer('jp-22')])))
      expect(screen.getByTestId('server-jp-22')).toBeTruthy()
      reply = page([summary('hk-1', 'offline')])
      const before = lists(calls)
      act(() => FakeWebSocket.latest().serverClose())
      expect(screen.getByTestId('feed-mode').textContent).toBe('定时刷新（每 10 秒）')
      // 断开的那一刻不闪回打开页面时的旧列表（hk-1 等待首次连接、没有 jp-22）
      expect(within(screen.getByTestId('server-hk-1')).queryByText('等待首次连接')).toBeNull()
      expect(screen.getByTestId('server-jp-22')).toBeTruthy()
      await waitFor(() => expect(lists(calls)).toBe(before + 1))
      expect(await within(screen.getByTestId('server-hk-1')).findByText('离线')).toBeTruthy()
      expect(screen.queryByTestId('server-jp-22')).toBeNull()
      const sockets = FakeWebSocket.instances.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_500)
      })
      expect(lists(calls)).toBeGreaterThan(before + 1)
      expect(FakeWebSocket.instances.length).toBeGreaterThan(sockets)
    } finally {
      vi.useRealTimers()
    }
  })

  it('推送连着时仍每 60 秒请求一次 server list（及时发现会话失效），显示仍按推送', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const calls = opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'pending')]) })
      renderApp('/servers')
      await screen.findByTestId('server-hk-1')
      act(() => FakeWebSocket.latest().push(dashboardFrame([dashboardServer('hk-1')], 30_000)))
      const before = lists(calls)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000)
      })
      expect(lists(calls)).toBe(before + 1)
      expect(screen.getByTestId('feed-mode').textContent).toBe('实时推送')
      expect(within(screen.getByTestId('server-hk-1')).getByText('在线')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('没有推送时卡片上的网速来自 server list', async () => {
    opsServer({ 'GET /api/v1/server': page([summary('hk-1', 'connected', { current_upload_speed: 512, current_download_speed: 0 })]) })
    renderApp('/servers')
    expect((await screen.findByTestId('speed-hk-1')).textContent).toBe('↑ 512 B/s ↓ 0 B/s')
  })
})
