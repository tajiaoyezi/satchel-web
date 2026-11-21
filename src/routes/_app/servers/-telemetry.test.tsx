import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall, FakeReply } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const server = {
  apiVersion: 'satchel/v1',
  kind: 'Server',
  metadata: { id: 1, name: 'hk-1', resourceVersion: 3 },
  spec: { name: 'hk-1', connection_mode: 'websocket' },
  status: { status: 'connected', last_heartbeat: '2026-11-21T10:00:00Z', ip_address: '203.0.113.7', ip_address_v6: '', boot_count: 1, core_running: true, core_version: '1.14.4', core_boot_count: 1 },
}

const GB = 1024 ** 3

const systemInfo = {
  server: 'hk-1',
  hostname: 'node-hk-1',
  os: 'Debian GNU/Linux 12',
  kernel: '6.1.0-18-amd64',
  arch: 'amd64',
  uptime_seconds: 90061,
  cpu_model: 'AMD EPYC 7B13',
  cpu_cores: 2,
  cpu_threads: 4,
  cpu_pct: 12.5,
  load1: 0.1,
  load5: 0.2,
  load15: 0.3,
  mem_total_bytes: 4 * GB,
  mem_used_bytes: 2 * GB,
  disk_total_bytes: 40 * GB,
  disk_used_bytes: 10 * GB,
  tcp_fast_open_server: true,
  agent_version: '0.2.0',
  in_docker: false,
  collected_at: '2026-11-21T10:00:00Z',
}

const nics = {
  server: 'hk-1',
  nics: [
    { name: 'eth0', addrs: [{ ip: '203.0.113.7', family: 'v4', cidr: '203.0.113.7/24', scope: 'global' }] },
    { name: 'eth1', addrs: [{ ip: '10.0.0.5', family: 'v4', cidr: '10.0.0.5/16', scope: 'private' }] },
  ],
}

const fail = (status: number, code: string, reason: string): FakeReply => ({ status, body: { code, reason, state: {}, next: '' } })

const base = (routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}) =>
  opsServer({ 'GET /api/v1/server/get/hk-1': { body: server }, 'GET /api/v1/server/traffic/hk-1': { body: { traffic: [] } }, ...routes })

const gets = (calls: FakeCall[], url: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === url)
const panel = () => within(screen.getByRole('tabpanel'))

async function openTab(name: string) {
  const user = userEvent.setup()
  renderApp('/servers/hk-1')
  await user.click(await screen.findByRole('tab', { name }))
  return user
}

// web-console「服务器页」的「系统」标签页（m2-14）。
describe('服务器详情页：系统', () => {
  it('读取系统信息：点了才请求两条；显示主机名、内存与磁盘用量与网卡作用域；切走再回来不重新请求', async () => {
    const calls = base({ 'GET /api/v1/server/system-info/hk-1': { body: systemInfo }, 'GET /api/v1/server/nics/hk-1': { body: nics } })
    const user = await openTab('系统')
    expect(gets(calls, '/api/v1/server/system-info/hk-1')).toHaveLength(0)
    await user.click(panel().getByRole('button', { name: '读取' }))
    expect(await panel().findByText('node-hk-1')).toBeTruthy()
    expect(panel().getByText('已用 2.0 GB / 共 4.0 GB')).toBeTruthy()
    expect(panel().getByText('已用 10 GB / 共 40 GB')).toBeTruthy()
    expect(panel().getByText('1 天 1 小时 1 分')).toBeTruthy()
    expect(within(panel().getByTestId('nic-eth0')).getByText('公网')).toBeTruthy()
    expect(within(panel().getByTestId('nic-eth1')).getByText('内网')).toBeTruthy()
    expect(gets(calls, '/api/v1/server/nics/hk-1')).toHaveLength(1)
    await user.click(screen.getByRole('tab', { name: '概况' }))
    await user.click(screen.getByRole('tab', { name: '系统' }))
    expect(panel().getByText('node-hk-1')).toBeTruthy()
    expect(gets(calls, '/api/v1/server/system-info/hk-1')).toHaveLength(1)
    await user.click(panel().getByRole('button', { name: '读取' }))
    await waitFor(() => expect(gets(calls, '/api/v1/server/system-info/hk-1')).toHaveLength(2))
    await waitFor(() => expect(gets(calls, '/api/v1/server/nics/hk-1')).toHaveLength(2))
  })

  it('节点不在线：显示主控的 reason', async () => {
    base({
      'GET /api/v1/server/system-info/hk-1': fail(503, 'unavailable', '服务器 "hk-1" 现在没有连接'),
      'GET /api/v1/server/nics/hk-1': fail(503, 'unavailable', '服务器 "hk-1" 现在没有连接'),
    })
    const user = await openTab('系统')
    await user.click(panel().getByRole('button', { name: '读取' }))
    await waitFor(() => expect(panel().getAllByText('服务器 "hk-1" 现在没有连接')).toHaveLength(2))
  })
})

const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ time: '2026-11-21T10:00:00Z', level: 'warn', msg: `dial failed ${from + i}`, attrs: { peer: '1.2.3.4' } }))

// web-console「服务器页」的「日志」标签页（m2-14）。
describe('服务器详情页：日志', () => {
  it('查看节点日志：第一次带 service、level、grep 与 limit，加载更多另外带 cursor，两页合起来显示', async () => {
    const calls = base({
      'GET /api/v1/server/logs/hk-1': (c) =>
        query(c).get('cursor') === 'c1'
          ? { body: { items: lines(100, 1), total: 101, nextCursor: '' } }
          : { body: { items: lines(0, 100), total: 101, nextCursor: 'c1' } },
    })
    const user = await openTab('日志')
    await user.click(panel().getByRole('combobox', { name: '来源' }))
    await user.click(await screen.findByRole('option', { name: '内核' }))
    await user.click(panel().getByRole('combobox', { name: '级别' }))
    await user.click(await screen.findByRole('option', { name: 'warn 及以上' }))
    await user.type(panel().getByLabelText('关键字（区分大小写）'), 'dial')
    await user.click(panel().getByRole('button', { name: '查询' }))
    expect(await panel().findByText('dial failed 0')).toBeTruthy()
    const first = query(gets(calls, '/api/v1/server/logs/hk-1')[0]!)
    expect(Object.fromEntries(first)).toEqual({ service: 'core', level: 'warn', grep: 'dial', limit: '100' })
    await user.click(panel().getByRole('button', { name: '加载更多' }))
    expect(await panel().findByText('dial failed 100')).toBeTruthy()
    expect(query(gets(calls, '/api/v1/server/logs/hk-1')[1]!).get('cursor')).toBe('c1')
    expect(panel().getByTestId('log-lines').children).toHaveLength(101)
    expect(panel().queryByRole('button', { name: /删除|清空/ })).toBeNull()
  })

  it('按日志文件查看：列出文件，点一个文件就按它查询；来源是 nginx 时改成 agent', async () => {
    const calls = base({
      'GET /api/v1/server/logs/files/hk-1': {
        body: {
          items: [
            { name: 'satchel-agent.log', size: 2048, modified: '2026-11-21T10:00:00Z', active: true },
            { name: 'satchel-agent-2026-11-19.log', size: 4096, modified: '2026-11-19T10:00:00Z', active: false },
          ],
          total: 2,
          nextCursor: '',
        },
      },
      'GET /api/v1/server/logs/hk-1': { body: { items: [{ raw: 'plain text line' }], total: 1, nextCursor: '' } },
    })
    const user = await openTab('日志')
    await user.click(panel().getByRole('combobox', { name: '来源' }))
    await user.click(await screen.findByRole('option', { name: 'nginx' }))
    await user.click(panel().getByRole('button', { name: '日志文件' }))
    expect(gets(calls, '/api/v1/server/logs/files/hk-1')).toHaveLength(1)
    await user.click(await panel().findByRole('button', { name: 'satchel-agent-2026-11-19.log' }))
    await waitFor(() => expect(gets(calls, '/api/v1/server/logs/hk-1')).toHaveLength(1))
    const q = query(gets(calls, '/api/v1/server/logs/hk-1')[0]!)
    expect(q.get('file')).toBe('satchel-agent-2026-11-19.log')
    expect(q.get('service')).toBe('agent')
    expect(await panel().findByText('plain text line')).toBeTruthy()
    expect((panel().getByLabelText('文件') as HTMLInputElement).value).toBe('satchel-agent-2026-11-19.log')
  })
})

const trafficView = (patch: object = {}) => ({
  body: {
    server: 'hk-1',
    since: '2026-11-21T08:00:00Z',
    collected_at: '2026-11-21T10:00:00Z',
    traffic: [],
    traffic_stats_mode: 'both',
    traffic_source: 'core',
    include_in_traffic_stats: true,
    system_rx_cycle: 0,
    system_tx_cycle: 0,
    system_traffic_updated_at: null,
    ...patch,
  },
})

const withStats = (stats: object, rv = 3) => ({ ...server, metadata: { ...server.metadata, resourceVersion: rv }, spec: { ...server.spec, ...stats } })
const coreStats = { traffic_stats_mode: 'both', traffic_source: 'core', include_in_traffic_stats: true }

// web-console「服务器页」流量页的统计口径（m2-14）。
describe('服务器详情页：流量统计口径', () => {
  it('修改流量统计口径：没改时不能保存；请求体只有改过的项与 resource-version；成功后显示新的口径与物理网卡累计', async () => {
    let saved = false
    const calls = base({
      'GET /api/v1/server/get/hk-1': () => ({ body: saved ? withStats({ traffic_stats_mode: 'max', traffic_source: 'system', include_in_traffic_stats: true }, 4) : withStats(coreStats) }),
      'GET /api/v1/server/traffic/hk-1': () =>
        saved ? trafficView({ traffic_stats_mode: 'max', traffic_source: 'system', system_rx_cycle: 1024 * 1024, system_tx_cycle: 2 * 1024 * 1024 }) : trafficView(),
      'POST /api/v1/server/traffic-stats/set/hk-1': () => {
        saved = true
        return { body: withStats({ traffic_stats_mode: 'max', traffic_source: 'system' }, 4) }
      },
    })
    const user = await openTab('流量')
    const card = within(await panel().findByTestId('traffic-stats'))
    await waitFor(() => expect(card.getByRole('button', { name: '保存口径' }).hasAttribute('disabled')).toBe(true))
    await user.click(card.getByRole('combobox', { name: '数据源' }))
    await user.click(await screen.findByRole('option', { name: '物理网卡' }))
    await user.click(card.getByRole('combobox', { name: '方向' }))
    await user.click(await screen.findByRole('option', { name: '取上下行较大的一边' }))
    await user.click(card.getByRole('button', { name: '保存口径' }))
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/server/traffic-stats/set/hk-1')?.body).toEqual({ 'resource-version': 3, mode: 'max', source: 'system' }),
    )
    const after = within(await panel().findByTestId('traffic-stats'))
    expect(await after.findByText('接收 1.0 MB，发送 2.0 MB')).toBeTruthy()
    expect(after.getAllByText('物理网卡').length).toBeGreaterThan(0)
  })

  it('当前值与版本号取自同一份 server get：server traffic 还是旧口径时，按 server get 比较并带它的版本号', async () => {
    const calls = base({
      'GET /api/v1/server/get/hk-1': { body: withStats({ traffic_stats_mode: 'max', traffic_source: 'core', include_in_traffic_stats: true }, 6) },
      'GET /api/v1/server/traffic/hk-1': trafficView({ traffic_stats_mode: 'both' }),
      'POST /api/v1/server/traffic-stats/set/hk-1': { body: server },
    })
    const user = await openTab('流量')
    const card = within(await panel().findByTestId('traffic-stats'))
    expect(await card.findByText('取上下行较大的一边', { selector: 'dd' })).toBeTruthy()
    await user.click(card.getByRole('combobox', { name: '方向' }))
    await user.click(await screen.findByRole('option', { name: '只算上行' }))
    await user.click(card.getByRole('button', { name: '保存口径' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/v1/server/traffic-stats/set/hk-1')?.body).toEqual({ 'resource-version': 6, mode: 'upload' }))
  })

  it('版本冲突：显示主控的 reason，提示别人刚改过并给「重新读取」', async () => {
    base({
      'GET /api/v1/server/get/hk-1': { body: withStats(coreStats) },
      'GET /api/v1/server/traffic/hk-1': trafficView(),
      'POST /api/v1/server/traffic-stats/set/hk-1': { status: 409, body: { code: 'version_conflict', reason: 'Server 期望版本是 3，当前版本是 4', state: {}, next: '' } },
    })
    const user = await openTab('流量')
    const card = within(await panel().findByTestId('traffic-stats'))
    await user.click(card.getByRole('switch', { name: '计入流量汇总' }))
    await waitFor(() => expect(card.getByRole('button', { name: '保存口径' }).hasAttribute('disabled')).toBe(false))
    await user.click(card.getByRole('button', { name: '保存口径' }))
    expect(await card.findByText('Server 期望版本是 3，当前版本是 4')).toBeTruthy()
    expect(card.getByText(/别人刚改过这台服务器/)).toBeTruthy()
    expect(card.getByRole('button', { name: '重新读取' })).toBeTruthy()
  })
})
