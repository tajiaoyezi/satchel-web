import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { planView, servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const builtin = {
  items: [
    { key: 'block-bt', name: '禁止 BitTorrent', description: '拒绝 BT 流量', match: { protocol: ['bittorrent'] }, default_outbound_tag: 'reject' },
    {
      key: 'warp-google-meta',
      name: '防止送中（Google / Meta）',
      description: '经 WARP 访问',
      match: { rule_set: ['geosite-google', 'geosite-meta'] },
      default_outbound_tag: 'warp',
      rule_sets: [{ tag: 'geosite-google', type: 'remote' }, { tag: 'geosite-meta', type: 'remote' }],
    },
  ],
  total: 2,
}

const saved = (id: number, name: string, rule: object) => ({ id, username: 'admin', name, rule, created_at: '2026-11-22T10:00:00Z', updated_at: '2026-11-22T10:00:00Z' })

const presetCalls = (calls: FakeCall[]) => calls.filter((c) => c.url.startsWith('/api/v1/routing/preset'))
const planSpec = (calls: FakeCall[]) => calls.filter((c) => c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/inbound': page([]),
    'GET /api/v1/outbound': page([]),
    'GET /api/v1/inbound/batch': page([]),
    'GET /api/v1/outbound/batch': page([]),
    'GET /api/v1/routing': page([]),
    'GET /api/v1/routing/preset/builtin': { body: builtin },
    'GET /api/v1/routing/preset': page([saved(3, 'example', { domain_suffix: ['example.com'] })]),
    'POST /api/v1/plan': { body: planView() },
    ...(routes as Record<string, never>),
  })

async function openPresets(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: '预设' }))
  return within(await screen.findByRole('tabpanel', { name: '预设' }))
}

// web-console「代理页」的预设部分（m2-20）。
describe('代理页：预设', () => {
  it('第一次打开「预设」之前不请求预设；打开后列出内置与已保存的预设', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    await screen.findByRole('tabpanel', { name: '入站' })
    await waitFor(() => expect(calls.some((c) => c.url.split('?')[0] === '/api/v1/routing')).toBe(true))
    expect(presetCalls(calls)).toEqual([])
    const tab = await openPresets(user)
    const bt = within(await tab.findByTestId('builtin-block-bt'))
    expect(bt.getByText('{"protocol":["bittorrent"]}')).toBeTruthy()
    expect(bt.getByText('reject')).toBeTruthy()
    expect(within(tab.getByTestId('builtin-warp-google-meta')).getByText('geosite-google, geosite-meta')).toBeTruthy()
    const row = within(await tab.findByTestId('preset-row-3'))
    expect(row.getByText('admin')).toBeTruthy()
    expect(row.getByText('{"domain_suffix":["example.com"]}')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/routing/preset/builtin')).toBe(true)
    expect(calls.some((c) => c.url.startsWith('/api/v1/routing/preset?'))).toBe(true)
  })

  it('从内置预设新建路由规则：填入匹配条件与默认出站，预演的 spec 是完整的新规则', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    const tab = await openPresets(user)
    await user.click(within(await tab.findByTestId('builtin-block-bt')).getByRole('button', { name: '用它新建规则' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建路由规则' }))
    expect(dialog.getByText('已填入预设「禁止 BitTorrent」。')).toBeTruthy()
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() =>
      expect(planSpec(calls)).toEqual([
        { op: 'create', kind: 'RoutingRule', spec: { server_id: 1, sort_order: 100, match: { protocol: ['bittorrent'] }, outbound_tag: 'reject', enabled: true, catch_all: false } },
      ]),
    )
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('内置预设的默认出站不在这台服务器上：选项写明这台服务器上没有；服务器默认取页面上选的那台', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    await user.click(await screen.findByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'jp-1' }))
    const tab = await openPresets(user)
    await user.click(within(await tab.findByTestId('builtin-warp-google-meta')).getByRole('button', { name: '用它新建规则' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建路由规则' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/outbound?') && query(c).get('server-name') === 'jp-1' && query(c).get('limit') === '500')).toBe(true))
    await user.click(dialog.getByRole('combobox', { name: '出站' }))
    expect(await screen.findByRole('option', { name: 'warp（这台服务器上没有）' })).toBeTruthy()
  })

  it('已保存的预设只填匹配条件，不填出站', async () => {
    const user = userEvent.setup()
    base()
    renderApp('/proxy')
    const tab = await openPresets(user)
    await user.click(within(await tab.findByTestId('preset-row-3')).getByRole('button', { name: '用它新建规则' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建路由规则' }))
    expect((dialog.getByLabelText('匹配条件（match）') as HTMLTextAreaElement).value).toBe('{\n  "domain_suffix": [\n    "example.com"\n  ]\n}')
    expect(dialog.getByRole('combobox', { name: '出站' }).textContent).toBe('选择出站')
  })

  it('保存与删除预设：rule 发原文，解析不了时不发；删除先弹危险确认，确认值是编号，取消时不发', async () => {
    const user = userEvent.setup()
    const calls = base({
      'POST /api/v1/routing/preset/save': { body: saved(4, '我的规则', { domain_suffix: ['example.com'] }) },
      'POST /api/v1/routing/preset/delete/3': { body: { deleted: true, id: 3 } },
    })
    renderApp('/proxy')
    const tab = await openPresets(user)
    await tab.findByTestId('preset-row-3')
    await user.click(tab.getByRole('button', { name: '保存预设' }))
    const dialog = within(await screen.findByRole('dialog', { name: '保存预设' }))
    await user.type(dialog.getByLabelText('名字'), '我的规则')
    const rule = dialog.getByLabelText('匹配条件（match）')
    await user.click(rule)
    await user.paste('["example.com"]')
    await user.click(dialog.getByRole('button', { name: '保存' }))
    expect(await dialog.findByText('match 的 JSON 解析不了，或者不是一个对象。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/routing/preset/save')).toBe(false)
    await user.clear(rule)
    await user.paste('{"domain_suffix":["example.com"]}')
    const lists = () => calls.filter((c) => c.url.startsWith('/api/v1/routing/preset?')).length
    const before = lists()
    await user.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/v1/routing/preset/save')?.body).toEqual({ name: '我的规则', rule: '{"domain_suffix":["example.com"]}' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '保存预设' })).toBeNull())
    await waitFor(() => expect(lists()).toBeGreaterThan(before))

    await user.click(within(tab.getByTestId('preset-row-3')).getByRole('button', { name: '删除' }))
    const confirm = within(await screen.findByRole('alertdialog'))
    expect(confirm.getByText('要确认的值：3')).toBeTruthy()
    await user.click(confirm.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(calls.some((c) => c.url === '/api/v1/routing/preset/delete/3')).toBe(false)
    await user.click(within(tab.getByTestId('preset-row-3')).getByRole('button', { name: '删除' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/v1/routing/preset/delete/3')?.body).toEqual({ confirm: '3' }))
  })
})
