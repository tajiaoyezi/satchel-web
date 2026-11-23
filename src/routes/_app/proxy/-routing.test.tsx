import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { planView, servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

import { outboundOptions, short } from './-routing'

afterEach(() => vi.unstubAllGlobals())

const rule = (id: number, spec: object = {}, patch: object = {}) => ({
  apiVersion: 'satchel/v1',
  kind: 'RoutingRule',
  metadata: { id, resourceVersion: 2 },
  spec: { server_id: 1, sort_order: 100, match: { protocol: ['bittorrent'] }, outbound_tag: 'reject', enabled: true, catch_all: false, ...spec },
  server_name: 'hk-1',
  is_inbound_catch_all: false,
  ...patch,
})

const outbound = (id: number, tag: string, group = '') => ({
  metadata: { id, resourceVersion: 1 },
  spec: { server_id: 1, tag, protocol: 'socks', settings: '***', balancer_group: group, probe: {} },
  status: { last_probe_ok: false, last_probe_latency_ms: null, last_probed_at: null },
})

const routingLists = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/v1/routing')
const planSpec = (calls: FakeCall[]) => calls.filter((c) => c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/inbound': page([]),
    'GET /api/v1/outbound': (c: FakeCall) => page(query(c).get('server-name') === 'hk-1' ? [outbound(7, 'out-7', 'pool-a'), outbound(8, 'out-8', 'pool-a')] : []),
    'GET /api/v1/inbound/batch': page([]),
    'GET /api/v1/outbound/batch': page([]),
    'GET /api/v1/routing': page([rule(5)]),
    'GET /api/v1/routing/get/5': { body: rule(5) },
    'POST /api/v1/plan': { body: planView() },
    ...(routes as Record<string, never>),
  })

async function openRouting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: '路由' }))
  return within(await screen.findByRole('tabpanel', { name: '路由' }))
}

// web-console「代理页」的路由部分（m2-20）。
describe('代理页：路由', () => {
  it('列表写明整机兜底、匹配全部流量、入站全兜底与遮蔽；按服务器、显示已删除与翻页的请求参数', async () => {
    const user = userEvent.setup()
    // 主控的遮蔽分析跳过整机兜底（catch_all）的规则，遮蔽者是匹配条件为空的普通规则
    const calls = base({
      'GET /api/v1/routing': (c: FakeCall) =>
        query(c).get('cursor') === '50'
          ? page([rule(9)])
          : page(
              [
                rule(4, { catch_all: true, match: {}, outbound_tag: 'direct' }),
                rule(5, { match: {} }),
                rule(6, {}, { shadowed_by: [5] }),
                rule(7, { match: { inbound: ['in-1'] } }, { is_inbound_catch_all: true, shadowed_by: [5] }),
                rule(8, { match: { inbound: ['in-1'], domain: ['x.example'] } }, { shadowed_by: [5, 7] }),
                rule(10, { match: {}, enabled: false }),
                rule(11, { match: {} }, { metadata: { id: 11, resourceVersion: 3, deletedAt: '2026-11-22T10:00:00Z' } }),
              ],
              '50',
            ),
    })
    renderApp('/proxy')
    const tab = await openRouting(user)
    const row = (id: number) => within(tab.getByTestId(`routing-row-${id}`))
    await tab.findByTestId('routing-row-4')
    expect(row(4).getByText('整机兜底')).toBeTruthy()
    expect(row(4).queryByText('匹配全部流量')).toBeNull()
    expect(row(5).getByText('匹配全部流量')).toBeTruthy()
    expect(row(5).queryByText('整机兜底')).toBeNull()
    expect(row(6).getByText('被 #5 遮蔽')).toBeTruthy()
    expect(row(6).queryByText('匹配全部流量')).toBeNull()
    expect(row(7).getByText('入站全兜底')).toBeTruthy()
    expect(row(8).getByText('被 #5、#7 遮蔽')).toBeTruthy()
    expect(row(10).queryByText('匹配全部流量')).toBeNull()
    expect(row(11).getByText('已删除')).toBeTruthy()
    expect(row(11).queryByText('匹配全部流量')).toBeNull()
    await user.click(tab.getByRole('button', { name: '加载更多' }))
    expect(await tab.findByTestId('routing-row-9')).toBeTruthy()
    expect(routingLists(calls).some((c) => query(c).get('cursor') === '50')).toBe(true)
    await user.click(screen.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await waitFor(() => expect(routingLists(calls).some((c) => query(c).get('server-name') === 'hk-1')).toBe(true))
    await user.click(tab.getByRole('switch', { name: '显示已删除' }))
    await waitFor(() => expect(routingLists(calls).some((c) => query(c).get('server-name') === 'hk-1' && query(c).get('include-deleted') === 'true')).toBe(true))
  })

  it('编辑只改排序：spec 只有 sort_order；没有改动时提示、不发请求', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(within(await tab.findByTestId('routing-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('routing-detail')
    expect((dialog.getByLabelText('匹配条件（match）') as HTMLTextAreaElement).value).toBe('{\n  "protocol": [\n    "bittorrent"\n  ]\n}')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('没有改动。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    const sort = dialog.getByLabelText('排序')
    await user.clear(sort)
    await user.type(sort, '50')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'RoutingRule', id: 5, resourceVersion: 2, spec: { sort_order: 50 } }]))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('新建：出站选项来自所选服务器；匹配条件解析不了时不发请求，留空发 {}', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(tab.getByRole('button', { name: '新建规则' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/留空即 \{\}，会匹配这台服务器的全部流量/)).toBeTruthy()
    expect(dialog.getByRole('button', { name: '预演' })).toHaveProperty('disabled', true)
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/outbound?') && query(c).get('server-name') === 'hk-1' && query(c).get('limit') === '500')).toBe(true))
    await user.click(dialog.getByRole('combobox', { name: '出站' }))
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(names).toEqual(['out-7', 'out-8', 'pool-a（负载均衡组）', 'direct（内置）', 'block（内置）', 'reject（内置）'])
    await user.click(screen.getByRole('option', { name: 'pool-a（负载均衡组）' }))
    const match = dialog.getByLabelText('匹配条件（match）')
    await user.click(match)
    await user.paste('{"domain":')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('match 的 JSON 解析不了，或者不是一个对象。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    await user.clear(match)
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() =>
      expect(planSpec(calls)).toEqual([
        { op: 'create', kind: 'RoutingRule', spec: { server_id: 1, sort_order: 100, match: {}, outbound_tag: 'pool-a', enabled: true, catch_all: false } },
      ]),
    )
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('新建提交之后表单锁住：不能再预演，也不能改字段', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/apply': { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'h2' }] } },
    })
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(tab.getByRole('button', { name: '新建规则' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('apply-server-hk-1')).toBeTruthy()
    expect(dialog.getByTestId('rule-locked')).toBeTruthy()
    expect(dialog.queryByRole('button', { name: '预演' })).toBeNull()
    // 字段在 disabled 的 fieldset 里：disabled 属性本身不变，看 :disabled
    expect(dialog.getByLabelText('排序').matches(':disabled')).toBe(true)
    expect(dialog.getByRole('combobox', { name: '出站' }).matches(':disabled')).toBe(true)
    await user.type(dialog.getByLabelText('排序'), '{Enter}')
    expect(calls.filter((c) => c.url === '/api/v1/plan')).toHaveLength(1)
  })

  it('编辑时当前出站不在这台服务器上：选项里写明这台服务器上没有', async () => {
    const user = userEvent.setup()
    base({ 'GET /api/v1/routing/get/5': { body: rule(5, { outbound_tag: 'warp' }) } })
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(within(await tab.findByTestId('routing-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('routing-detail')
    await user.click(dialog.getByRole('combobox', { name: '出站' }))
    expect(await screen.findByRole('option', { name: 'warp（这台服务器上没有）' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'out-7' })).toBeTruthy()
  })

  it('编辑提交后：版本变了、表单重新读取，节点结果仍然显示', async () => {
    const user = userEvent.setup()
    let rv = 2
    const calls = base({
      'GET /api/v1/routing/get/5': () => ({ body: rule(5, {}, { metadata: { id: 5, resourceVersion: rv } }) }),
      'POST /api/v1/apply': () => {
        rv = 3
        return { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'h2' }] } }
      },
    })
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(within(await tab.findByTestId('routing-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('routing-detail')
    await user.click(dialog.getByRole('switch', { name: '启用' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'RoutingRule', id: 5, resourceVersion: 2, spec: { enabled: false } }]))
    const before = routingLists(calls).length
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('apply-server-hk-1')).toBeTruthy()
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/v1/routing/get/5').length).toBe(2))
    await waitFor(() => expect(routingLists(calls).length).toBeGreaterThan(before))
    expect(dialog.getByTestId('apply-server-hk-1')).toBeTruthy()
    expect(dialog.getByRole('switch', { name: '启用' }).getAttribute('aria-checked')).toBe('true')
  })

  it('删除带读到的版本号；恢复带已删除对象的版本号', async () => {
    const user = userEvent.setup()
    const calls = base({
      'GET /api/v1/routing': (c: FakeCall) => page(query(c).get('include-deleted') === 'true' ? [rule(5), rule(8, {}, { metadata: { id: 8, resourceVersion: 5, deletedAt: '2026-11-22T10:00:00Z' } })] : [rule(5)]),
    })
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(within(await tab.findByTestId('routing-row-5')).getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog', { name: '删除路由规则 hk-1 → reject（#5）' })).toBeTruthy()
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'delete', kind: 'RoutingRule', id: 5, resourceVersion: 2 }]))
    await user.keyboard('{Escape}')
    await user.click(tab.getByRole('switch', { name: '显示已删除' }))
    const row = within(await tab.findByTestId('routing-row-8'))
    expect(row.getByText('已删除')).toBeTruthy()
    expect(row.queryByRole('button', { name: '查看' })).toBeNull()
    await user.click(row.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(planSpec(calls)[1]).toEqual({ op: 'restore', kind: 'RoutingRule', id: 8, resourceVersion: 5 }))
  })

  it('规则表单里存为预设：用匹配条件框的内容，发原文', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/routing/preset/save': { body: { id: 4, username: 'admin', name: 'bt', rule: { protocol: ['bittorrent'] } } } })
    renderApp('/proxy')
    const tab = await openRouting(user)
    await user.click(within(await tab.findByTestId('routing-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('routing-detail')
    await user.click(dialog.getByRole('button', { name: '存为预设' }))
    const row = within(dialog.getByTestId('save-as-preset'))
    await user.type(row.getByLabelText('名字'), ' bt ')
    await user.click(row.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/v1/routing/preset/save')?.body).toEqual({ name: 'bt', rule: '{\n  "protocol": [\n    "bittorrent"\n  ]\n}' }),
    )
    await waitFor(() => expect(dialog.queryByTestId('save-as-preset')).toBeNull())
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
  })
})

describe('路由的显示与出站选项', () => {
  it('short：紧凑的 JSON，超过 80 个字符时截断', () => {
    expect(short({ protocol: ['bittorrent'] })).toBe('{"protocol":["bittorrent"]}')
    expect(short(null)).toBe('{}')
    const long = short({ domain: Array.from({ length: 20 }, (_, i) => `d${i}.example.com`) })
    expect(long).toHaveLength(80)
    expect(long.endsWith('…')).toBe(true)
  })

  it('outboundOptions：出站、去重的负载均衡组、内置三项，当前值不在里面时补上', () => {
    const ob = (tag: string, group = '') => ({ spec: { tag, balancer_group: group } })
    expect(outboundOptions([ob('direct'), ob('a', 'g'), ob('b', 'g')], 'warp', true)).toEqual([
      { tag: 'direct', kind: 'outbound' },
      { tag: 'a', kind: 'outbound' },
      { tag: 'b', kind: 'outbound' },
      { tag: 'g', kind: 'group' },
      { tag: 'block', kind: 'builtin' },
      { tag: 'reject', kind: 'builtin' },
      { tag: 'warp', kind: 'missing' },
    ])
    expect(outboundOptions([], 'warp', false).at(-1)).toEqual({ tag: 'warp', kind: 'outbound' })
    expect(outboundOptions([], 'reject', true)).toHaveLength(3)
  })
})
