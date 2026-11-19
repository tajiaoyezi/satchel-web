import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall, FakeReply } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const server = (mode = 'pull') => ({
  apiVersion: 'satchel/v1',
  kind: 'Server',
  metadata: { id: 1, name: 'hk-1' },
  spec: { name: 'hk-1', connection_mode: mode, listen_port: 0, pull_port: 24000 },
  status: { status: 'connected', last_heartbeat: '2026-11-18T10:00:00Z', ip_address: '203.0.113.7', ip_address_v6: '', boot_count: 1, core_running: true, core_version: '1.14.4', core_boot_count: 1 },
})

const check = (patch: object = {}) => ({
  body: {
    server: 'hk-1',
    channel: 'stable',
    current_version: '0.1.0',
    latest_version: '0.2.0',
    has_update: true,
    in_docker: false,
    reachable: true,
    compatible: true,
    can_apply: true,
    ...patch,
  },
})

const job = (patch: object = {}) => ({
  body: { job_id: 'job-9', kind: 'server update apply', status: 'queued', created_at: '2026-11-18T10:00:00Z', started_at: null, finished_at: null, exit_code: null, output: null, output_truncated: false, ...patch },
})

const fail = (status: number, code: string, reason: string, next = ''): FakeReply => ({ status, body: { code, reason, state: {}, next } })

const base = (routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}, mode = 'pull') =>
  opsServer({ 'GET /api/v1/server/get/hk-1': { body: server(mode) }, 'GET /api/v1/server/traffic/hk-1': { body: { traffic: [] } }, ...routes })

const post = (calls: FakeCall[], url: string) => calls.find((c) => c.method === 'POST' && c.url === url)
const gets = (calls: FakeCall[], url: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === url)

// panel 是当前可见的标签页：连接、限速、踢线与维护页切走后仍然挂着（hidden），查询要限定在可见的那一页。
const panel = () => within(screen.getByRole('tabpanel'))

async function openMaintenance() {
  const user = userEvent.setup()
  renderApp('/servers/hk-1')
  await user.click(await screen.findByRole('tab', { name: '维护' }))
  return user
}

// web-console「服务器页」的维护部分（m2-10）。
describe('服务器详情页：维护', () => {
  it('检查节点版本：点了才请求，带渠道；显示两个版本与升级入口；换渠道后旧结果不再显示', async () => {
    const calls = base({ 'GET /api/v1/server/update/check/hk-1': check() })
    const user = await openMaintenance()
    expect(gets(calls, '/api/v1/server/update/check/hk-1')).toHaveLength(0)
    await user.click(panel().getByRole('button', { name: '检查' }))
    expect(await panel().findByText('0.1.0')).toBeTruthy()
    expect(panel().getByText('0.2.0')).toBeTruthy()
    expect(query(gets(calls, '/api/v1/server/update/check/hk-1')[0]!).get('channel')).toBe('stable')
    expect(panel().getByRole('button', { name: '升级到 0.2.0' })).toBeTruthy()
    await user.click(panel().getByRole('combobox', { name: '更新渠道' }))
    await user.click(await screen.findByRole('option', { name: '预发布版（prerelease）' }))
    await waitFor(() => expect(panel().queryByRole('button', { name: '升级到 0.2.0' })).toBeNull())
    expect(panel().queryByTestId('update-check')).toBeNull()
  })

  it('不能升级：显示主控给的原因，没有升级入口', async () => {
    base({ 'GET /api/v1/server/update/check/hk-1': check({ in_docker: true, can_apply: false, reason: 'Docker 容器内不支持自更新，请更换镜像 tag 后重建容器' }) })
    const user = await openMaintenance()
    await user.click(panel().getByRole('button', { name: '检查' }))
    expect(await panel().findByText('不能：Docker 容器内不支持自更新，请更换镜像 tag 后重建容器')).toBeTruthy()
    expect(panel().queryByRole('button', { name: /^升级到/ })).toBeNull()
  })

  it('升级要确认服务器名：取消不发请求；确认后带 channel 与 confirm，跟到 done 显示前后版本并重新读取概况', async () => {
    let polls = 0
    const calls = base({
      'GET /api/v1/server/update/check/hk-1': check(),
      'POST /api/v1/server/update/apply/hk-1/0.2.0': job(),
      'GET /api/v1/job/get/job-9': () =>
        ++polls < 2 ? job({ status: 'running' }) : job({ status: 'done', output: JSON.stringify({ server: 'hk-1', from_version: '0.1.0', to_version: '0.2.0', status: 'done' }) }),
    })
    const user = await openMaintenance()
    await user.click(panel().getByRole('button', { name: '检查' }))
    await user.click(await panel().findByRole('button', { name: '升级到 0.2.0' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    expect(screen.getByText(/原地重启 satchel-agent/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText('要确认的值：hk-1')).toBeNull())
    expect(post(calls, '/api/v1/server/update/apply/hk-1/0.2.0')).toBeUndefined()
    await user.click(panel().getByRole('button', { name: '升级到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/update/apply/hk-1/0.2.0')?.body).toEqual({ channel: 'stable', confirm: 'hk-1' }))
    const before = gets(calls, '/api/v1/server/get/hk-1').length
    expect(await panel().findByText('已从 0.1.0 升到 0.2.0', {}, { timeout: 4000 })).toBeTruthy()
    await waitFor(() => expect(gets(calls, '/api/v1/server/get/hk-1').length).toBeGreaterThan(before))
    expect(panel().queryByRole('button', { name: '升级到 0.2.0' })).toBeNull()
  })

  it('升级进行中切到概况再回来：进度还在，结束后显示结果（维护页保留挂载）', async () => {
    let polls = 0
    base({
      'GET /api/v1/server/update/check/hk-1': check(),
      'POST /api/v1/server/update/apply/hk-1/0.2.0': job(),
      'GET /api/v1/job/get/job-9': () =>
        ++polls < 3 ? job({ status: 'running' }) : job({ status: 'done', output: JSON.stringify({ server: 'hk-1', from_version: '0.1.0', to_version: '0.2.0', status: 'done' }) }),
    })
    const user = await openMaintenance()
    await user.click(panel().getByRole('button', { name: '检查' }))
    await user.click(await panel().findByRole('button', { name: '升级到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await panel().findByTestId('job-progress')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: '概况' }))
    await user.click(screen.getByRole('tab', { name: '维护' }))
    expect(panel().getByTestId('job-progress')).toBeTruthy()
    expect(await panel().findByText('已从 0.1.0 升到 0.2.0', {}, { timeout: 5000 })).toBeTruthy()
  })

  it('升级失败时写明磁盘状态与不能直接重试', async () => {
    const output = JSON.stringify({
      code: 'unavailable',
      reason: '服务器 "hk-1" 升级至 0.2.0 失败：节点替换后未在确认窗内恢复',
      state: { disk_state: 'new_unconfirmed', retryable: false, batch_continue: false },
      next: '',
    })
    base({
      'GET /api/v1/server/update/check/hk-1': check(),
      'POST /api/v1/server/update/apply/hk-1/0.2.0': job(),
      'GET /api/v1/job/get/job-9': job({ status: 'failed', output }),
    })
    const user = await openMaintenance()
    await user.click(panel().getByRole('button', { name: '检查' }))
    await user.click(await panel().findByRole('button', { name: '升级到 0.2.0' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await panel().findByText('服务器 "hk-1" 升级至 0.2.0 失败：节点替换后未在确认窗内恢复', {}, { timeout: 4000 })).toBeTruthy()
    expect(panel().getByText('新版本可能已经写进节点，但主控没有确认它在运行。')).toBeTruthy()
    expect(panel().getByText(/不要直接重试/)).toBeTruthy()
  })

  it('探测主控地址：选恢复地址，请求带 target，显示地址、可达与延迟；主控拒绝时显示 reason', async () => {
    let n = 0
    const calls = base({
      'GET /api/v1/server/probe-master-url/hk-1': () =>
        ++n === 1
          ? { body: { server: 'hk-1', target: 'recovery', url: 'https://recovery.example.com', reachable: true, latency_ms: 35 } }
          : fail(409, 'conflict', '系统设置中的 master 地址（""）未配置为合法 https origin'),
    })
    const user = await openMaintenance()
    await user.click(panel().getByRole('combobox', { name: '探测哪个地址' }))
    await user.click(await screen.findByRole('option', { name: '恢复地址' }))
    await user.click(panel().getByRole('button', { name: '探测' }))
    expect(await panel().findByText('https://recovery.example.com')).toBeTruthy()
    expect(panel().getByText('可达，延迟 35 毫秒')).toBeTruthy()
    expect(query(gets(calls, '/api/v1/server/probe-master-url/hk-1')[0]!).get('target')).toBe('recovery')
    await user.click(panel().getByRole('button', { name: '探测' }))
    expect(await panel().findByText('系统设置中的 master 地址（""）未配置为合法 https origin')).toBeTruthy()
  })

  it('切换端口：只填管理端口，确认后请求体只有它与 confirm，成功后重新读取概况', async () => {
    const calls = base({ 'POST /api/v1/server/switch-listen-port/hk-1': { body: server() } })
    const user = await openMaintenance()
    const listen = await panel().findByLabelText('管理端口')
    expect(listen.getAttribute('placeholder')).toBe('当前 23889')
    expect(panel().getByLabelText('轮询端口').getAttribute('placeholder')).toBe('当前 24000')
    await user.type(listen, '24001')
    await user.click(panel().getByRole('button', { name: '切换' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    const before = gets(calls, '/api/v1/server/get/hk-1').length
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/switch-listen-port/hk-1')?.body).toEqual({ 'listen-port': 24001, confirm: 'hk-1' }))
    await waitFor(() => expect(gets(calls, '/api/v1/server/get/hk-1').length).toBeGreaterThan(before))
  })

  it('websocket 模式没有切换端口这一块', async () => {
    base({}, 'websocket')
    await openMaintenance()
    expect(await panel().findByRole('button', { name: '卸载' })).toBeTruthy()
    expect(panel().queryByTestId('switch-ports')).toBeNull()
  })

  it('卸载要确认服务器名：确认框写全后果，请求带 confirm，成功后重新读取概况；在 Docker 里时显示主控的 reason', async () => {
    let n = 0
    const calls = base({
      'POST /api/v1/server/uninstall/hk-1': () =>
        ++n === 1
          ? { body: { server: 'hk-1', uninstalled: true, scheduled_at: '2026-11-18T10:05:00Z', status: 'offline' } }
          : fail(409, 'conflict', '服务器 "hk-1" 运行在 Docker 容器内，请通过停止并移除容器来卸载'),
    })
    const user = await openMaintenance()
    await user.click(panel().getByRole('button', { name: '卸载' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    const dialog = within(screen.getByRole('alertdialog'))
    expect(dialog.getByText(/服务器记录保留/)).toBeTruthy()
    expect(dialog.getByText(/得用安装命令重装/)).toBeTruthy()
    const before = gets(calls, '/api/v1/server/get/hk-1').length
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(post(calls, '/api/v1/server/uninstall/hk-1')?.body).toEqual({ confirm: 'hk-1' }))
    expect(await panel().findByTestId('uninstall-result')).toBeTruthy()
    await waitFor(() => expect(gets(calls, '/api/v1/server/get/hk-1').length).toBeGreaterThan(before))
    await user.click(panel().getByRole('button', { name: '卸载' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await panel().findByText('服务器 "hk-1" 运行在 Docker 容器内，请通过停止并移除容器来卸载')).toBeTruthy()
  })
})
