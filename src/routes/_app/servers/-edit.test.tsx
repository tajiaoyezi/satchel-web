import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall, FakeReply } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const spec = {
  name: 'hk-1',
  ipv6_enabled: false,
  domain: '',
  domain_v6: '',
  connection_mode: 'websocket',
  pull_address: '',
  pull_address_v6: '',
  pull_port: 0,
  listen_port: 0,
  lock_entry_ip: false,
  use_443: false,
  steal_mode: 'tunnel',
  site_type: '',
  site_value: '',
  port_range_min: 0,
  port_range_max: 0,
  traffic_limit: 0,
  traffic_reset_day: 0,
  traffic_stats_mode: 'both',
  traffic_source: 'system',
  include_in_traffic_stats: true,
  traffic_calibration: 0,
  region: '',
  region_country: '',
  region_name: '',
  region_city: '',
  renewal_price: 0,
  renewal_cycle: 'month',
  renewal_currency: 'CNY',
  provider_name: '',
  provider_url: '',
  telecom_paid_peer: false,
  expires_at: null,
  ddns_enabled: false,
  ddns_provider_id: null,
  ddns_record_name: '',
  core_log_level: 'warn',
  core_dns: null,
  core_stats_enabled: true,
  sort_order: 0,
}

const server = (name = 'hk-1') => ({
  apiVersion: 'satchel/v1',
  kind: 'Server',
  metadata: { id: 1, name, resourceVersion: 3 },
  spec: { ...spec, name },
  status: { status: 'connected', last_heartbeat: '2026-11-22T10:00:00Z', ip_address: '203.0.113.7', ip_address_v6: '', boot_count: 1, core_running: true, core_version: '1.14.4', core_boot_count: 1 },
})

const planView = (patch: object = {}) => ({
  plan_id: 8,
  status: 'pending',
  affected_count: 1,
  expires_at: '2026-11-22T10:10:00Z',
  created_at: '2026-11-22T10:00:00Z',
  required_dangers: [],
  objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', field_diff: { region: { before: '', after: '东京' } } }],
  servers: [],
  ...patch,
})

const base = (routes: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}) =>
  opsServer({ 'GET /api/v1/server/get/hk-1': { body: server() }, 'GET /api/v1/server/traffic/hk-1': { body: { traffic: [] } }, ...routes })

const plans = (calls: FakeCall[]) => calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)
const panel = () => within(screen.getByRole('tabpanel'))

async function openEdit() {
  const user = userEvent.setup()
  const utils = renderApp('/servers/hk-1')
  await user.click(await screen.findByRole('tab', { name: '编辑' }))
  await panel().findByRole('button', { name: '预演' })
  return { user, ...utils }
}

async function retype(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const input = panel().getByLabelText(label)
  await user.clear(input)
  await user.type(input, value)
}

// web-console「服务器页」的「编辑」标签页（m2-16）。
describe('服务器详情页：编辑', () => {
  it('编辑服务器只发改过的字段：没改时不能预演；预演请求里只有 region 与 sort_order，显示预演结果', async () => {
    const calls = base({ 'POST /api/v1/plan': { body: planView() } })
    const { user } = await openEdit()
    expect(panel().getByRole('button', { name: '预演' }).hasAttribute('disabled')).toBe(true)
    await retype(user, '地区', '东京')
    await retype(user, '排序（越小越靠前）', '5')
    await user.click(panel().getByRole('button', { name: '预演' }))
    await waitFor(() => expect(plans(calls)).toHaveLength(1))
    expect(plans(calls)[0]).toEqual({ op: 'update', kind: 'Server', id: 1, resourceVersion: 3, spec: { region: '东京', sort_order: 5 } })
    expect(await panel().findByTestId('plan-field-region')).toBeTruthy()
  })

  it('JSON 框里改了的键也会发出，没改的不发', async () => {
    const calls = base({ 'POST /api/v1/plan': { body: planView() } })
    const { user } = await openEdit()
    const box = panel().getByLabelText('其余字段（JSON）') as HTMLTextAreaElement
    const next = { ...(JSON.parse(box.value) as Record<string, unknown>), steal_mode: 'fallback' }
    await user.clear(box)
    await user.click(box)
    await user.paste(JSON.stringify(next))
    await user.click(panel().getByRole('button', { name: '预演' }))
    await waitFor(() => expect(plans(calls)[0]).toEqual({ op: 'update', kind: 'Server', id: 1, resourceVersion: 3, spec: { steal_mode: 'fallback' } }))
  })

  it('JSON 编辑框解析不了：提示，不发请求', async () => {
    const calls = base()
    const { user } = await openEdit()
    const box = panel().getByLabelText('其余字段（JSON）')
    await user.clear(box)
    await user.type(box, '{{')
    await user.click(panel().getByRole('button', { name: '预演' }))
    expect(await panel().findByText(/JSON 解析不了/)).toBeTruthy()
    expect(plans(calls)).toHaveLength(0)
  })

  it('改了名字：提交成功后转到新名字的详情页', async () => {
    const calls = base({
      'GET /api/v1/server/get/hk-2': { body: server('hk-2') },
      'GET /api/v1/server/traffic/hk-2': { body: { traffic: [] } },
      'POST /api/v1/plan': { body: planView({ objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', field_diff: { name: { before: 'hk-1', after: 'hk-2' } } }] }) },
      'POST /api/v1/apply': { body: { plan_id: 8, apply_id: 'ap-2', affected_count: 1, objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-2', resourceVersion: 4 }], servers: [] } },
    })
    const { user, router } = await openEdit()
    await retype(user, '名字', 'hk-2')
    await user.click(panel().getByRole('button', { name: '预演' }))
    const oldGets = () => calls.filter((c) => c.url === '/api/v1/server/get/hk-1').length
    const before = oldGets()
    await user.click(await panel().findByRole('button', { name: '提交' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/servers/hk-2'))
    expect(calls.find((c) => c.url === '/api/v1/apply')?.body).toEqual({ plan: 8 })
    // 旧名字已经不存在：不再去请求它，详情页不会闪一下 not_found
    expect(oldGets()).toBe(before)
  })

  it('删除后恢复：删除的预演是 delete，提交要输入服务器名；写明软删除后给出恢复，恢复的预演带删除后的版本号', async () => {
    let n = 0
    const calls = base({
      'POST /api/v1/plan': () =>
        ++n === 1
          ? { body: planView({ plan_id: 9, required_dangers: ['delete'], confirm_hint: 'hk-1', objects: [{ op: 'delete', kind: 'Server', id: 1, name: 'hk-1', field_diff: { deleted: { before: false, after: true } } }] }) }
          : { body: planView({ plan_id: 10, required_dangers: ['delete'], confirm_hint: 'hk-1', objects: [{ op: 'restore', kind: 'Server', id: 1, name: 'hk-1' }] }) },
      'POST /api/v1/apply': (c) =>
        (c.body as { plan: number }).plan === 9
          ? { body: { plan_id: 9, apply_id: 'ap-d', affected_count: 1, objects: [{ op: 'delete', kind: 'Server', id: 1, name: 'hk-1', resourceVersion: 4 }], servers: [] } }
          : { body: { plan_id: 10, apply_id: 'ap-r', affected_count: 1, objects: [{ op: 'restore', kind: 'Server', id: 1, name: 'hk-1', resourceVersion: 5 }], servers: [] } },
    })
    const { user } = await openEdit()
    expect(panel().getByText(/软删除：服务器从列表里消失/)).toBeTruthy()
    await user.click(panel().getByRole('button', { name: '删除服务器' }))
    await waitFor(() => expect(plans(calls)[0]).toEqual({ op: 'delete', kind: 'Server', id: 1, resourceVersion: 3 }))
    const card = within(panel().getByText('删除服务器', { selector: '[data-slot="card-title"]' }).closest('[data-slot="card"]') as HTMLElement)
    await user.click(await card.findByRole('button', { name: '提交' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/v1/apply')?.body).toEqual({ plan: 9, confirm: 'hk-1' }))
    expect((await panel().findByTestId('server-deleted')).textContent).toContain('已软删除 hk-1（id 1）')
    await user.click(panel().getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(plans(calls)[1]).toEqual({ op: 'restore', kind: 'Server', id: 1, resourceVersion: 4 }))
  })

  it('切走再回来，预演结果还在', async () => {
    base({ 'POST /api/v1/plan': { body: planView() } })
    const { user } = await openEdit()
    await retype(user, '地区', '东京')
    await user.click(panel().getByRole('button', { name: '预演' }))
    await panel().findByTestId('plan-review')
    await user.click(screen.getByRole('tab', { name: '概况' }))
    await user.click(screen.getByRole('tab', { name: '编辑' }))
    expect(panel().getByTestId('plan-review')).toBeTruthy()
  })
})

// web-console「服务器页」的「节点配置」标签页（m2-16）。
describe('服务器详情页：节点配置', () => {
  async function openConfig() {
    const user = userEvent.setup()
    renderApp('/servers/hk-1')
    await user.click(await screen.findByRole('tab', { name: '节点配置' }))
    return user
  }

  it('查看节点配置的同步状态：写明不一致并显示两个哈希', async () => {
    const calls = base({
      'GET /api/v1/server/config/status/hk-1': {
        body: { server: 'hk-1', exists: true, hash: 'node-hash-1', applied_hash: 'applied-hash-1', desired_hash: 'desired-hash-2', in_sync: false, applied_generation: 3, inbounds: ['in1'], kernel_running: true, kernel_version: '1.14.4', size: 2048 },
      },
    })
    const user = await openConfig()
    await user.click(panel().getByRole('button', { name: '查看同步状态' }))
    const status = within(await panel().findByTestId('config-status'))
    expect(status.getByText('不一致')).toBeTruthy()
    expect(status.getByText('node-hash-1')).toBeTruthy()
    expect(status.getByText('desired-hash-2')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/server/config/status/hk-1')).toBe(true)
  })

  it('列出文件，点一个路径就带 path 读取并显示内容，打码时写明', async () => {
    const calls = base({
      'GET /api/v1/server/config/files/hk-1': { body: { items: [{ scope: 'kernel', path: '/var/lib/satchel-agent/kernel.json', size: 1024, modified: '2026-11-22T10:00:00Z' }], total: 1, nextCursor: '' } },
      'GET /api/v1/server/config/read/hk-1': { body: { server: 'hk-1', scope: 'kernel', path: '/var/lib/satchel-agent/kernel.json', content: '{"log":{}}', size: 10, modified: '2026-11-22T10:00:00Z', redacted: true } },
    })
    const user = await openConfig()
    await user.click(panel().getByRole('button', { name: '列出文件' }))
    expect(query(calls.find((c) => c.url.startsWith('/api/v1/server/config/files/hk-1'))!).get('scope')).toBe('all')
    await user.click(await panel().findByRole('button', { name: '/var/lib/satchel-agent/kernel.json' }))
    const read = within(await panel().findByTestId('config-read'))
    expect(read.getByText('{"log":{}}')).toBeTruthy()
    expect(read.getByText('敏感字段已打码。')).toBeTruthy()
    expect(query(calls.find((c) => c.url.startsWith('/api/v1/server/config/read/hk-1'))!).get('path')).toBe('/var/lib/satchel-agent/kernel.json')
  })

  it('校验失败时显示错误；节点不在线时显示主控的 reason', async () => {
    base({
      'GET /api/v1/server/config/test/hk-1': { body: { server: 'hk-1', ok: false, error: 'inbound in1: unknown field', inbounds: [], hash: 'h' } },
      'GET /api/v1/server/config/status/hk-1': { status: 503, body: { code: 'unavailable', reason: '服务器 "hk-1" 现在没有连接', state: {}, next: '' } },
    })
    const user = await openConfig()
    await user.click(panel().getByRole('button', { name: '校验当前配置' }))
    expect(within(await panel().findByTestId('config-test')).getByText('inbound in1: unknown field')).toBeTruthy()
    await user.click(panel().getByRole('button', { name: '查看同步状态' }))
    expect(await panel().findByText('服务器 "hk-1" 现在没有连接')).toBeTruthy()
  })
})
