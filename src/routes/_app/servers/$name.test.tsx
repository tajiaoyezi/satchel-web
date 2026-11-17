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
  metadata: { id: 1, name: 'hk-1' },
  spec: { name: 'hk-1', connection_mode: 'websocket' },
  status: {
    token: 'tok-should-not-show',
    agent_token: '***',
    pull_token: '***',
    status: 'connected',
    last_heartbeat: '2026-11-17T10:00:00Z',
    ip_address: '203.0.113.7',
    ip_address_v6: '',
    offline_since: null,
    boot_count: 2,
    core_running: true,
    core_version: '1.14.4',
    core_boot_time: '2026-11-17T09:00:00Z',
    core_boot_count: 3,
  },
}

const traffic = (patch: object = {}) => ({
  body: {
    server: 'hk-1',
    since: '2026-11-17T08:00:00Z',
    collected_at: '2026-11-17T10:00:00Z',
    core_running: true,
    core_version: '1.14.4',
    core_boot_time: '2026-11-17T09:00:00Z',
    core_boot_count: 3,
    traffic: [{ inbound: 'in1', outbound: 'out1', credential: 'A', uplink: 2048, downlink: 10485760 }],
    ...patch,
  },
})

const fail = (status: number, code: string, reason: string, next = ''): FakeReply => ({ status, body: { code, reason, state: {}, next } })

const base = (routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}) =>
  opsServer({ 'GET /api/v1/server/get/hk-1': { body: server }, 'GET /api/v1/server/traffic/hk-1': traffic(), ...routes })

const post = (calls: FakeCall[], url: string) => calls.find((c) => c.method === 'POST' && c.url === url)

// web-console「服务器页」的详情部分。
describe('服务器详情页', () => {
  it('概况：显示状态、地址、心跳与内核，不显示令牌', async () => {
    base()
    renderApp('/servers/hk-1')
    expect(await screen.findByText('203.0.113.7')).toBeTruthy()
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.getByText('websocket')).toBeTruthy()
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('1.14.4')).toBeTruthy()
    expect(document.body.textContent).not.toContain('tok-should-not-show')
    expect(document.body.textContent).not.toContain('***')
  })

  it('服务器不存在：显示主控的 not_found', async () => {
    opsServer({ 'GET /api/v1/server/get/nope': fail(404, 'not_found', '没有服务器 "nope"') })
    renderApp('/servers/nope')
    expect(await screen.findByText('没有服务器 "nope"')).toBeTruthy()
  })

  it('取安装命令：点了才请求，显示命令、主控地址与指纹，复制的是命令原文', async () => {
    const user = userEvent.setup()
    const command = "curl -fsSL 'https://panel.example.com/api/remote/install.sh' | sh -s -- --token 'abc'"
    const calls = base({
      'GET /api/v1/server/install-command/hk-1': { body: { server: 'hk-1', command, master_url: 'https://panel.example.com', master_key_fingerprint: 'SHA256:xyz' } },
    })
    renderApp('/servers/hk-1')
    await screen.findByText('203.0.113.7')
    expect(calls.some((c) => c.url.includes('/install-command/'))).toBe(false)
    await user.click(screen.getByRole('button', { name: '取安装命令' }))
    expect((await screen.findByTestId('install-command')).textContent).toBe(command)
    expect(screen.getByText('https://panel.example.com')).toBeTruthy()
    expect(screen.getByText('SHA256:xyz')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe(command))
  })

  it('安装命令不留在页面上：切到别的标签页再回来，不点按钮就不显示', async () => {
    const user = userEvent.setup()
    const calls = base({
      'GET /api/v1/server/install-command/hk-1': { body: { server: 'hk-1', command: 'install --token abc', master_url: 'https://panel.example.com', master_key_fingerprint: 'SHA256:xyz' } },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('button', { name: '取安装命令' }))
    expect(await screen.findByTestId('install-command')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: '流量' }))
    await user.click(screen.getByRole('tab', { name: '概况' }))
    await screen.findByRole('button', { name: '取安装命令' })
    expect(screen.queryByTestId('install-command')).toBeNull()
    expect(calls.filter((c) => c.url.includes('/install-command/'))).toHaveLength(1)
  })

  it('主控地址没设好：显示 reason 与 next', async () => {
    const user = userEvent.setup()
    base({ 'GET /api/v1/server/install-command/hk-1': fail(409, 'conflict', '主控地址还没有设', '先用 settings master-url set 设一个 https 地址') })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('button', { name: '取安装命令' }))
    expect(await screen.findByText('主控地址还没有设')).toBeTruthy()
    expect(screen.getByText('下一步：先用 settings master-url set 设一个 https 地址')).toBeTruthy()
  })

  it('流量：按入站、出站、凭据列上下行；从一行进入限速时填好入站与凭据', async () => {
    const user = userEvent.setup()
    base()
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '流量' }))
    const row = await screen.findByTestId('traffic-in1-out1-A')
    expect(within(row).getByText('2.0 KB')).toBeTruthy()
    expect(within(row).getByText('10 MB')).toBeTruthy()
    expect(screen.getByText(/主控重启后从零开始/)).toBeTruthy()
    await user.click(within(row).getByRole('button', { name: '限速' }))
    expect(await screen.findByLabelText('入站')).toHaveValue('in1')
    expect(screen.getByLabelText('凭据')).toHaveValue('A')
  })

  it('流量：还没有收到快照时写明', async () => {
    const user = userEvent.setup()
    base({ 'GET /api/v1/server/traffic/hk-1': traffic({ since: null, collected_at: null, traffic: [] }) })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '流量' }))
    expect(await screen.findByText('还没有收到这台服务器的流量快照。')).toBeTruthy()
    expect(screen.getByText('还没有流量记录。')).toBeTruthy()
  })

  it('连接清单翻页：第一次带 inbound、credential 与 limit，第二次另外带 cursor', async () => {
    const user = userEvent.setup()
    const conn = (id: number) => ({ id, network: 'tcp', peer: `198.51.100.${id}:443`, outbound: 'out1', start: '2026-11-17T10:00:00Z' })
    const calls = base({
      'GET /api/v1/server/connections/hk-1': (call) =>
        query(call).get('cursor') === 'c1' ? { body: { items: [conn(3)], total: 3, nextCursor: '' } } : { body: { items: [conn(1), conn(2)], total: 3, nextCursor: 'c1' } },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '连接' }))
    await user.type(screen.getByLabelText('入站'), 'in1')
    await user.type(screen.getByLabelText('凭据'), 'A')
    await user.click(screen.getByRole('button', { name: '查询' }))
    expect(await screen.findByText('198.51.100.2:443')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('198.51.100.3:443')).toBeTruthy()
    expect(screen.getByText('198.51.100.1:443')).toBeTruthy()
    const reqs = calls.filter((c) => c.url.startsWith('/api/v1/server/connections/hk-1')).map(query)
    expect(reqs[0].get('inbound')).toBe('in1')
    expect(reqs[0].get('credential')).toBe('A')
    expect(reqs[0].get('limit')).toBe('100')
    expect(reqs[0].get('cursor')).toBeNull()
    expect(reqs[1].get('cursor')).toBe('c1')
  })

  it('设主控临时限速：请求体字段齐全，结果显示三份来源与生效值', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/server/limit/set/hk-1': {
        body: { server: 'hk-1', inbound: 'in1', credential: 'A', sources: [{ source: 'master', bps: 5000000, mbps: 5, deadline: '2026-11-17T10:30:00Z' }], limited: true, effective_bps: 5000000, effective_mbps: 5 },
      },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '限速' }))
    await user.type(screen.getByLabelText('入站'), 'in1')
    await user.type(screen.getByLabelText('凭据'), 'A')
    await user.type(screen.getByLabelText('限速（Mbps）'), '5')
    await user.type(screen.getByLabelText('有效时长'), '30m')
    await user.click(screen.getByRole('button', { name: '设置' }))
    const result = await screen.findByTestId('limit-result')
    expect(post(calls, '/api/v1/server/limit/set/hk-1')?.body).toEqual({ inbound: 'in1', credential: 'A', mbps: 5, 'expires-in': '30m' })
    expect(within(result).getByText(/^5 Mbps（到 /)).toBeTruthy()
    expect(within(result).getAllByText('未设')).toHaveLength(2)
    expect(within(result).getByText('生效值：5 Mbps')).toBeTruthy()
  })

  it('有效时长不填时不发 expires-in；0 显示为不限', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/server/limit/set/hk-1': { body: { server: 'hk-1', inbound: 'in1', credential: 'A', sources: [{ source: 'master', bps: 0, mbps: 0 }], limited: false, effective_bps: 0, effective_mbps: 0 } },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '限速' }))
    await user.type(screen.getByLabelText('入站'), 'in1')
    await user.type(screen.getByLabelText('凭据'), 'A')
    await user.type(screen.getByLabelText('限速（Mbps）'), '0')
    await user.click(screen.getByRole('button', { name: '设置' }))
    const result = await screen.findByTestId('limit-result')
    expect(post(calls, '/api/v1/server/limit/set/hk-1')?.body).toEqual({ inbound: 'in1', credential: 'A', mbps: 0 })
    expect(within(result).getByText('不限')).toBeTruthy()
    expect(within(result).getByText('现在不限速')).toBeTruthy()
  })

  it('撤掉主控临时限速：请求体只有入站与凭据，显示现在不限速', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/server/limit/clear/hk-1': { body: { server: 'hk-1', inbound: 'in1', credential: 'A', sources: [], limited: false, effective_bps: 0, effective_mbps: 0 } },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '限速' }))
    await user.type(screen.getByLabelText('入站'), 'in1')
    await user.type(screen.getByLabelText('凭据'), 'A')
    await user.click(screen.getByRole('button', { name: '撤掉' }))
    const result = await screen.findByTestId('limit-result')
    expect(post(calls, '/api/v1/server/limit/clear/hk-1')?.body).toEqual({ inbound: 'in1', credential: 'A' })
    expect(within(result).getAllByText('未设')).toHaveLength(3)
    expect(within(result).getByText('现在不限速')).toBeTruthy()
  })

  it('服务器不在线时：按钮照常可用，显示主控的 reason 与 next', async () => {
    const user = userEvent.setup()
    base({
      'GET /api/v1/server/get/hk-1': { body: { ...server, status: { ...server.status, status: 'offline' } } },
      'POST /api/v1/server/limit/set/hk-1': fail(503, 'unavailable', '服务器 "hk-1" 现在没有连接', '用 server get hk-1 看在线状态，等它连上再试'),
    })
    renderApp('/servers/hk-1')
    expect(await screen.findByText('离线')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: '限速' }))
    await user.type(screen.getByLabelText('入站'), 'in1')
    await user.type(screen.getByLabelText('凭据'), 'A')
    await user.type(screen.getByLabelText('限速（Mbps）'), '5')
    const submit = screen.getByRole('button', { name: '设置' })
    expect(submit).toBeEnabled()
    await user.click(submit)
    expect(await screen.findByText('服务器 "hk-1" 现在没有连接')).toBeTruthy()
    expect(screen.getByText('下一步：用 server get hk-1 看在线状态，等它连上再试')).toBeTruthy()
  })

  it('不填入站踢线：写明会踢所有入站，请求体没有 inbound，显示踢掉的条数', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/server/kick/hk-1': { body: { server: 'hk-1', credential: 'A', kicked: 3 } } })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '踢线' }))
    await user.type(screen.getByLabelText('凭据'), 'A')
    expect(screen.getByText('没填入站：会踢 A 在所有入站上的连接。')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '踢线' }))
    expect((await screen.findByTestId('kick-result')).textContent).toBe('踢掉了 3 条连接')
    expect(post(calls, '/api/v1/server/kick/hk-1')?.body).toEqual({ credential: 'A' })
  })

  it('重启内核：确认值是服务器名，取消时不发请求，确认后带 confirm 并显示结果', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/server/restart-kernel/hk-1': { body: { server: 'hk-1', running: true, version: '1.14.4', started_at: '2026-11-17T10:05:00Z', inbounds: ['in1', 'in2'] } },
    })
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('button', { name: '重启内核' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText('要确认的值：hk-1')).toBeNull())
    expect(post(calls, '/api/v1/server/restart-kernel/hk-1')).toBeUndefined()
    await user.click(screen.getByRole('button', { name: '重启内核' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    const result = await screen.findByTestId('restart-result')
    expect(post(calls, '/api/v1/server/restart-kernel/hk-1')?.body).toEqual({ confirm: 'hk-1' })
    expect(within(result).getByText('in1, in2')).toBeTruthy()
  })
})
