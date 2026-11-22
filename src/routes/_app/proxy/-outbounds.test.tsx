import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { matrix, planView, servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const outbound = (id: number, spec: object = {}, patch: object = {}) => ({
  apiVersion: 'satchel/v1',
  kind: 'Outbound',
  metadata: { id, resourceVersion: 2 },
  spec: { server_id: 1, tag: `out-${id}`, protocol: 'socks', settings: '***', is_warp: false, balancer_group: '', probe: {}, ...spec },
  status: { last_probe_ok: false, last_probe_latency_ms: null, last_probed_at: null },
  server_name: 'hk-1',
  ...patch,
})

const inbound = (id: number, serverId: number, tag: string) => ({
  metadata: { id, resourceVersion: 1 },
  spec: { server_id: serverId, tag, protocol: 'vless', port: 443, listen: '', tls: '***', transport: {}, settings: '***', enabled: true, sort_order: 0 },
})

const outboundLists = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/v1/outbound')
const planSpec = (calls: FakeCall[]) => calls.filter((c) => c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/inbound': (c: FakeCall) => page(query(c).get('server-name') === 'jp-1' ? [inbound(9, 2, 'vless-443')] : query(c).get('server-name') === 'hk-1' ? [inbound(3, 1, 'ss-8443')] : []),
    'GET /api/v1/outbound': page([outbound(7)]),
    'GET /api/v1/inbound/batch': page([]),
    'GET /api/v1/outbound/batch': page([]),
    'GET /api/v1/inbound/protocols': { body: matrix },
    'POST /api/v1/plan': { body: planView() },
    ...(routes as Record<string, never>),
  })

async function openOutbounds(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: '出站' }))
  return within(await screen.findByRole('tabpanel', { name: '出站' }))
}

// web-console「代理页」的出站部分（m2-18）。
describe('代理页：出站', () => {
  it('探测出站：请求带 timeout，显示结果，之后重新请求出站列表', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/outbound/probe/7': { body: { id: 7, server: 'hk-1', tag: 'out-7', url: 'https://www.gstatic.com/generate_204', ok: true, latency_ms: 123, status_code: 204, probed_at: '2026-11-22T10:00:00Z' } },
    })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(within(await tab.findByTestId('outbound-row-7')).getByRole('button', { name: '探测' }))
    const dialog = within(await screen.findByRole('dialog'))
    const before = outboundLists(calls).length
    await user.click(dialog.getByRole('button', { name: '探测' }))
    const result = within(await dialog.findByTestId('probe-result'))
    expect(result.getByText('可用')).toBeTruthy()
    expect(result.getByText('123 ms')).toBeTruthy()
    expect(calls.find((c) => c.url === '/api/v1/outbound/probe/7')?.body).toEqual({ timeout: '10s' })
    await waitFor(() => expect(outboundLists(calls).length).toBeGreaterThan(before))
  })

  it('探测时节点不在线：显示主控的 reason', async () => {
    const user = userEvent.setup()
    base({ 'POST /api/v1/outbound/probe/7': { status: 503, body: { code: 'unavailable', reason: '节点 hk-1 不在线', state: {}, next: '' } } })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(within(await tab.findByTestId('outbound-row-7')).getByRole('button', { name: '探测' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByLabelText('探测地址'), 'https://example.com/')
    await user.click(dialog.getByRole('button', { name: '探测' }))
    expect(await dialog.findByText('节点 hk-1 不在线')).toBeTruthy()
  })

  it('新建出站：spec 带服务器 id、tag、协议与解析后的 settings；JSON 解析不了或不是对象时提示、不发请求', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(tab.getByRole('button', { name: '新建出站' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.type(dialog.getByLabelText('tag'), 'to-jp')
    await user.type(dialog.getByLabelText(/^协议/), 'socks')
    const settings = dialog.getByLabelText('settings')
    await user.click(settings)
    await user.paste('{"server":')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('settings 的 JSON 解析不了，或者不是一个对象。')).toBeTruthy()
    await user.clear(settings)
    await user.paste('[1, 2]')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(dialog.getByText('settings 的 JSON 解析不了，或者不是一个对象。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    await user.clear(settings)
    await user.paste('{"server":"203.0.113.9","server_port":1080}')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() =>
      expect(planSpec(calls)).toEqual([{ op: 'create', kind: 'Outbound', spec: { server_id: 1, tag: 'to-jp', protocol: 'socks', balancer_group: '', settings: { server: '203.0.113.9', server_port: 1080 } } }]),
    )
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('编辑出站只发改过的字段；按负载均衡组过滤时请求带 balancer-group', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/outbound/get/7': { body: outbound(7, { probe: { strategy: 'urltest' } }) } })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.type(tab.getByLabelText('按负载均衡组过滤'), 'hk-pool')
    await user.click(tab.getByRole('button', { name: '查询' }))
    await waitFor(() => expect(outboundLists(calls).some((c) => query(c).get('balancer-group') === 'hk-pool')).toBe(true))
    await user.click(within(await tab.findByTestId('outbound-row-7')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('outbound-detail')
    await user.type(dialog.getByLabelText('负载均衡组'), 'pool-a')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'Outbound', id: 7, resourceVersion: 2, spec: { balancer_group: 'pool-a' } }]))
  })

  it('落地规划的两种来源：引用时带 target-server 与 target-inbound；手工时带 protocol 与 settings；作用于某个入站时带 inbound-tag', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/outbound/landing/plan': { body: planView() } })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(tab.getByRole('button', { name: '落地规划' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '源服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.type(dialog.getByLabelText('新出站的 tag'), 'to-jp')
    await user.click(dialog.getByRole('combobox', { name: '目标服务器' }))
    await user.click(await screen.findByRole('option', { name: 'jp-1' }))
    await user.click(dialog.getByRole('combobox', { name: '目标入站' }))
    await user.click(await screen.findByRole('option', { name: 'vless-443（vless:443）' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    const landings = () => calls.filter((c) => c.url === '/api/v1/outbound/landing/plan').map((c) => c.body as Record<string, unknown>)
    await waitFor(() => expect(landings()).toHaveLength(1))
    expect(landings()[0]).toEqual({ 'server-name': 'hk-1', 'outbound-tag': 'to-jp', 'sort-order': 100, 'target-server': 'jp-1', 'target-inbound': 'vless-443' })
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
    await user.click(dialog.getByRole('combobox', { name: '作用范围' }))
    await user.click(await screen.findByRole('option', { name: '某个入站' }))
    await user.click(dialog.getByRole('combobox', { name: '入站' }))
    await user.click(await screen.findByRole('option', { name: 'ss-8443（vless:443）' }))
    await user.click(dialog.getByRole('combobox', { name: '落地目标的来源' }))
    await user.click(await screen.findByRole('option', { name: '手工填协议与 settings' }))
    await user.type(dialog.getByLabelText('协议'), 'socks')
    await user.click(dialog.getByLabelText('settings'))
    await user.paste('{"server":"203.0.113.9"}')
    await user.click(dialog.getAllByRole('button', { name: '预演' })[0]!)
    await waitFor(() => expect(landings()).toHaveLength(2))
    expect(landings()[1]).toEqual({ 'server-name': 'hk-1', 'outbound-tag': 'to-jp', 'sort-order': 100, 'inbound-tag': 'ss-8443', protocol: 'socks', settings: '{"server":"203.0.113.9"}' })
    expect(calls.some((c) => c.url.startsWith('/api/v1/inbound?') && query(c).get('server-name') === 'jp-1')).toBe(true)
  })

  it('批量新建出站：请求体带 servers、tag、protocol 与填了的可选字段', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/outbound/batch/plan': { body: planView() } })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(tab.getByRole('button', { name: '批量新建' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('checkbox', { name: 'jp-1' }))
    await user.type(dialog.getByLabelText('tag'), 'warp-out')
    await user.type(dialog.getByLabelText('协议'), 'direct')
    await user.type(dialog.getByLabelText('负载均衡组'), 'pool-a')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/v1/outbound/batch/plan')?.body).toEqual({ servers: ['jp-1'], tag: 'warp-out', protocol: 'direct', 'balancer-group': 'pool-a' }))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })
})

// 审查后补的（m2-18 复查）：编辑出站提交后结果留着；探测失败时不显示延迟。
describe('代理页：出站的细节', () => {
  it('编辑出站提交后：版本变了、表单重新读取，节点结果仍然显示', async () => {
    const user = userEvent.setup()
    let rv = 2
    const calls = base({
      'GET /api/v1/outbound/get/7': () => ({ body: outbound(7, {}, { metadata: { id: 7, resourceVersion: rv } }) }),
      'POST /api/v1/apply': () => {
        rv = 3
        return { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'h2' }] } }
      },
    })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(within(await tab.findByTestId('outbound-row-7')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('outbound-detail')
    await user.type(dialog.getByLabelText('负载均衡组'), 'pool-a')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('apply-server-hk-1')).toBeTruthy()
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/v1/outbound/get/7').length).toBe(2))
    expect(dialog.getByTestId('apply-server-hk-1')).toBeTruthy()
    expect((dialog.getByLabelText('负载均衡组') as HTMLInputElement).value).toBe('')
  })

  it('探测失败：显示错误，不显示 0 ms 的延迟', async () => {
    const user = userEvent.setup()
    base({ 'POST /api/v1/outbound/probe/7': { body: { id: 7, server: 'hk-1', tag: 'out-7', url: 'https://x/', ok: false, latency_ms: 0, status_code: 0, error: 'dial tcp: timeout', probed_at: '2026-11-22T10:00:00Z' } } })
    renderApp('/proxy')
    const tab = await openOutbounds(user)
    await user.click(within(await tab.findByTestId('outbound-row-7')).getByRole('button', { name: '探测' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: '探测' }))
    const result = within(await dialog.findByTestId('probe-result'))
    expect(result.getByText('dial tcp: timeout')).toBeTruthy()
    expect(result.queryByText('0 ms')).toBeNull()
  })
})
