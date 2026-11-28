import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall, FakeReply } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const server = (name: string, sameHost: boolean) => ({
  apiVersion: 'satchel/v1',
  kind: 'Server',
  metadata: { id: 1, name },
  spec: { name, connection_mode: 'websocket', listen_port: 0, pull_port: 24000 },
  status: { status: 'connected', last_heartbeat: '2026-11-28T10:00:00Z', ip_address: '203.0.113.7', ip_address_v6: '', boot_count: 1, core_running: true, core_version: '1.14.4', core_boot_count: 1, same_host_as_master: sameHost },
})

const status = {
  kernel: { running: true, version: 'sing-box 1.14.4', started_at: '2026-11-28T09:00:00Z' },
  nginx: { installed: true, running: true, version: '1.26.2', in_docker: false, init_system: 'systemd', config_ok: true },
  agent: { running: true, version: '0.3.0', uptime_seconds: 3600, in_docker: false },
  checked_at: '2026-11-28T10:00:00Z',
}

const block = (conf: string, patch: object = {}) => ({ kind: 'http', conf_path: conf, managed: true, server_names: ['app.example.com'], listen_ports: ['80'], root: '/var/www/app', has_ssl: false, ...patch })

const job = (patch: object = {}) => ({
  body: { job_id: 'job-1', kind: 'server nginx uninstall', status: 'queued', created_at: '2026-11-28T10:00:00Z', started_at: null, finished_at: null, exit_code: null, output: null, output_truncated: false, ...patch },
})

const base = (name: string, sameHost: boolean, routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}) =>
  opsServer({
    [`GET /api/v1/server/get/${name}`]: { body: server(name, sameHost) },
    [`GET /api/v1/server/traffic/${name}`]: { body: { traffic: [] } },
    [`GET /api/v1/server/service/status/${name}`]: { body: status },
    [`GET /api/v1/server/nginx/servers/${name}`]: (c: FakeCall) => (query(c).get('cursor') === '50' ? page([block('/etc/nginx/servers/b.conf')]) : page([block('/etc/nginx/servers/a.conf')], '50')),
    ...routes,
  })

const post = (calls: FakeCall[], url: string) => calls.find((c) => c.method === 'POST' && c.url === url)
const gets = (calls: FakeCall[], url: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === url)

async function openServices(name: string) {
  const user = userEvent.setup()
  renderApp(`/servers/${name}`)
  await user.click(await screen.findByRole('tab', { name: '服务' }))
  return { user, tab: within(await screen.findByRole('tabpanel', { name: '服务' })) }
}

const verifyAs = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('密码'), 'secret12')
  await user.click(screen.getByRole('button', { name: '确认' }))
}

// web-console「服务器详情页的服务标签页」（m2-22）。
describe('服务器详情页：服务', () => {
  it('第一次打开之前不请求服务状态与巡检；打开后显示三项服务与 server 块，巡检能翻页，能刷新', async () => {
    const user = userEvent.setup()
    const calls = base('hk-1', false)
    renderApp('/servers/hk-1')
    await screen.findByRole('tab', { name: '服务' })
    await waitFor(() => expect(gets(calls, '/api/v1/server/get/hk-1').length).toBeGreaterThan(0))
    expect(calls.some((c) => c.url.startsWith('/api/v1/server/service') || c.url.startsWith('/api/v1/server/nginx'))).toBe(false)
    await user.click(screen.getByRole('tab', { name: '服务' }))
    const tab = within(await screen.findByRole('tabpanel', { name: '服务' }))
    expect(within(await tab.findByTestId('service-kernel')).getByText('sing-box 1.14.4')).toBeTruthy()
    const nginx = within(tab.getByTestId('service-nginx'))
    expect(nginx.getByText('已安装')).toBeTruthy()
    expect(nginx.getByText('systemd')).toBeTruthy()
    expect(within(tab.getByTestId('service-agent')).getByText('3600 秒')).toBeTruthy()
    expect(tab.queryByTestId('services-same-host')).toBeNull()
    const servers = within(tab.getByTestId('nginx-servers'))
    expect(await servers.findByText('/etc/nginx/servers/a.conf')).toBeTruthy()
    await user.click(tab.getByRole('button', { name: '加载更多' }))
    expect(await servers.findByText('/etc/nginx/servers/b.conf')).toBeTruthy()
    const before = gets(calls, '/api/v1/server/service/status/hk-1').length
    await user.click(tab.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(gets(calls, '/api/v1/server/service/status/hk-1').length).toBe(before + 1))
  })

  it('重启 nginx：危险确认的值是服务器名，取消不发请求；确认后不弹当场验证，请求体带 service、action 与 confirm，之后重新读取状态', async () => {
    const calls = base('hk-1', false, { 'POST /api/v1/server/service/control/hk-1': { body: { service: 'nginx', action: 'restart', running: true, status } } })
    const { user, tab } = await openServices('hk-1')
    await tab.findByTestId('service-status')
    await user.click(tab.getByRole('button', { name: '执行' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText('要确认的值：hk-1')).toBeNull())
    expect(post(calls, '/api/v1/server/service/control/hk-1')).toBeUndefined()
    const before = gets(calls, '/api/v1/server/service/status/hk-1').length
    await user.click(tab.getByRole('button', { name: '执行' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/service/control/hk-1')?.body).toEqual({ service: 'nginx', action: 'restart', confirm: 'hk-1' }))
    expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull()
    expect((await tab.findByTestId('service-control-result')).textContent).toContain('nginx：运行中')
    await waitFor(() => expect(gets(calls, '/api/v1/server/service/status/hk-1').length).toBeGreaterThan(before))
  })

  it('服务只有 kernel 与 nginx，不能控制 agent；kernel 没有「重载」', async () => {
    base('hk-1', false)
    const { user, tab } = await openServices('hk-1')
    await user.click(tab.getByRole('combobox', { name: '服务' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['内核（kernel）', 'nginx'])
    await user.click(screen.getByRole('option', { name: '内核（kernel）' }))
    await user.click(tab.getByRole('combobox', { name: '动作' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['启动', '停止', '重启'])
  })

  it('清理 stream：请求体带 port 与 confirm；显示删掉的文件与是否重载', async () => {
    const calls = base('hk-1', false, {
      'POST /api/v1/server/nginx/clear-stream/hk-1': { body: { port: 8443, removed_files: ['/etc/nginx/stream_servers/8443.conf'], reloaded: true } },
    })
    const { user, tab } = await openServices('hk-1')
    await user.type(tab.getByLabelText('端口'), '8443')
    await user.click(tab.getByRole('button', { name: '清理' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/nginx/clear-stream/hk-1')?.body).toEqual({ port: 8443, confirm: 'hk-1' }))
    const result = await tab.findByTestId('clear-result')
    expect(result.textContent).toContain('/etc/nginx/stream_servers/8443.conf')
    expect(result.textContent).toContain('nginx 已重载。')
  })

  it('同机服务器卸载 nginx：先确认、再当场验证，请求体带 confirm 与 verify-password；跟踪长任务，完成后重新读取状态', async () => {
    let polls = 0
    const calls = base('local', true, {
      'POST /api/v1/server/nginx/uninstall/local': job(),
      'GET /api/v1/job/get/job-1': () => (++polls < 2 ? job({ status: 'running' }) : job({ status: 'done', output: JSON.stringify({ uninstalled: true, in_docker: false, message: '节点未安装 nginx' }) })),
    })
    const { user, tab } = await openServices('local')
    expect(await tab.findByTestId('services-same-host')).toBeTruthy()
    await tab.findByTestId('service-status')
    const before = gets(calls, '/api/v1/server/service/status/local').length
    await user.click(tab.getByRole('button', { name: '卸载 nginx' }))
    expect(await screen.findByText('要确认的值：local')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await verifyAs(user)
    await waitFor(() => expect(post(calls, '/api/v1/server/nginx/uninstall/local')?.body).toEqual({ confirm: 'local', 'verify-password': 'secret12' }))
    expect((await tab.findByTestId('nginx-job-done')).textContent).toBe('nginx 已卸载。 节点未安装 nginx')
    await waitFor(() => expect(gets(calls, '/api/v1/server/service/status/local').length).toBeGreaterThan(before))
  })

  it('同机服务器：安装 nginx 取消当场验证时不发请求；控制 kernel 不弹当场验证', async () => {
    const calls = base('local', true, { 'POST /api/v1/server/service/control/local': { body: { service: 'kernel', action: 'restart', running: true, status } } })
    const { user, tab } = await openServices('local')
    await tab.findByTestId('service-status')
    await user.click(tab.getByRole('button', { name: '安装 nginx' }))
    await user.click(within(await screen.findByRole('dialog', { name: '当场验证' })).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull())
    expect(post(calls, '/api/v1/server/nginx/install/local')).toBeUndefined()
    await user.click(tab.getByRole('combobox', { name: '服务' }))
    await user.click(await screen.findByRole('option', { name: '内核（kernel）' }))
    await user.click(tab.getByRole('button', { name: '执行' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/service/control/local')?.body).toEqual({ service: 'kernel', action: 'restart', confirm: 'local' }))
    expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull()
  })

  it('不同机的服务器安装 nginx：不弹当场验证，请求体为空；已经装好时写明', async () => {
    const calls = base('hk-1', false, {
      'POST /api/v1/server/nginx/install/hk-1': job({ kind: 'server nginx install' }),
      'GET /api/v1/job/get/job-1': job({ status: 'done', output: JSON.stringify({ installed: true, already_installed: true, in_docker: true }) }),
    })
    const { user, tab } = await openServices('hk-1')
    await user.click(tab.getByRole('button', { name: '安装 nginx' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/nginx/install/hk-1')?.body).toEqual({}))
    expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull()
    expect(await tab.findByText('nginx 已经装好，不用再装。')).toBeTruthy()
  })
})
