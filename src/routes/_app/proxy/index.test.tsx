import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import { matrix, planView, servers } from '@/test/proxy'
import { adminAccount, type FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const inbound = (id: number, patch: object = {}, spec: object = {}) => ({
  apiVersion: 'satchel/v1',
  kind: 'Inbound',
  metadata: { id, resourceVersion: 3 },
  spec: { server_id: 1, tag: `ss-${id}`, protocol: 'shadowsocks', port: 443, listen: '', tls: {}, transport: {}, settings: '***', enabled: true, sort_order: 0, ...spec },
  server_name: 'hk-1',
  ...patch,
})

const panel = () => within(screen.getByRole('tabpanel'))
// 路由按需加载：页面出来之前先等标签页
const findPanel = async () => within(await screen.findByRole('tabpanel'))
const planSpec = (calls: FakeCall[]) => calls.filter((c) => c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)
const inboundLists = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/v1/inbound')

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/inbound': page([inbound(5)]),
    'GET /api/v1/outbound': page([]),
    'GET /api/v1/inbound/batch': page([]),
    'GET /api/v1/outbound/batch': page([]),
    'GET /api/v1/inbound/protocols': { body: matrix },
    ...(routes as Record<string, never>),
  })

// web-console「代理页」的入站部分与「布局与导航」的「代理页只对管理员显示」（m2-18）。
describe('代理页：入站', () => {
  it('普通用户直接打开 /proxy：显示没有权限，不请求入站与服务器', async () => {
    const calls = opsServer({}, { ...adminAccount, username: 'bob', role: 'user' })
    renderApp('/proxy')
    expect(await screen.findByText('这一页只对管理员开放。')).toBeTruthy()
    expect(calls.some((c) => c.url.startsWith('/api/v1/inbound') || c.url.startsWith('/api/v1/server'))).toBe(false)
  })

  it('按服务器看入站：请求带 server-name，打开「显示已删除」后带 include-deleted', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    expect(await screen.findByTestId('inbound-row-5')).toBeTruthy()
    expect(query(inboundLists(calls)[0]!).get('server-name')).toBeNull()
    await user.click(screen.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await waitFor(() => expect(inboundLists(calls).some((c) => query(c).get('server-name') === 'hk-1')).toBe(true))
    await user.click(panel().getByRole('switch', { name: '显示已删除' }))
    await waitFor(() => expect(inboundLists(calls).some((c) => query(c).get('server-name') === 'hk-1' && query(c).get('include-deleted') === 'true')).toBe(true))
  })

  it('按协议过滤与翻页：过滤带 protocol，「加载更多」带 cursor', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/inbound': (c: FakeCall) => (query(c).get('cursor') ? page([inbound(6)]) : page([inbound(5)], '50')) })
    renderApp('/proxy')
    await screen.findByTestId('inbound-row-5')
    await user.click(panel().getByRole('button', { name: '加载更多' }))
    expect(await screen.findByTestId('inbound-row-6')).toBeTruthy()
    expect(inboundLists(calls).some((c) => query(c).get('cursor') === '50')).toBe(true)
    await user.type(panel().getByLabelText('按协议过滤'), 'vless')
    await user.click(panel().getByRole('button', { name: '查询' }))
    await waitFor(() => expect(inboundLists(calls).some((c) => query(c).get('protocol') === 'vless')).toBe(true))
  })

  it('入站详情里的打码：settings 写明已打码、不显示 ***；显示 Reality 公钥', async () => {
    const user = userEvent.setup()
    base({ 'GET /api/v1/inbound/get/5': { body: inbound(5, { derived: { reality_public_key: 'pub-1' } }) } })
    renderApp('/proxy')
    await user.click(within(await screen.findByTestId('inbound-row-5')).getByRole('button', { name: '查看' }))
    const detail = within(await screen.findByTestId('inbound-detail'))
    expect(detail.getByText('已打码（网页登录没有 secrets 权限，主控不返回原文）')).toBeTruthy()
    expect(detail.queryByText('***')).toBeNull()
    expect(detail.getByText('pub-1')).toBeTruthy()
  })

  it('向导生成并预演：build 不带 password 与 uuid、不进缓存；显示凭据；plan 的 spec 是 plan_op', async () => {
    const user = userEvent.setup()
    const planOp = { op: 'create', kind: 'Inbound', spec: { server_id: 1, tag: 'shadowsocks-8443', protocol: 'shadowsocks', port: 8443, settings: { method: '2022-blake3-aes-128-gcm', password: 'psk-1' } } }
    const calls = base({
      'GET /api/v1/inbound/build': { body: { server: 'hk-1', server_id: 1, spec: planOp.spec, credentials: { user_name: 'default', server_psk: 'psk-1' }, plan_op: planOp } },
      'POST /api/v1/plan': { body: planView() },
    })
    renderApp('/proxy')
    await user.click(await (await findPanel()).findByRole('button', { name: '新建入站' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    await user.type(dialog.getByLabelText('端口'), '8443')
    await user.click(dialog.getByRole('button', { name: '生成' }))
    const result = within(await dialog.findByTestId('wizard-result'))
    const build = calls.find((c) => c.url.startsWith('/api/v1/inbound/build'))!
    const q = query(build)
    expect([q.get('server-name'), q.get('protocol'), q.get('port'), q.get('transport'), q.get('security')]).toEqual(['hk-1', 'shadowsocks', '8443', 'tcp', 'none'])
    expect(q.has('password') || q.has('uuid')).toBe(false)
    expect(build.cache).toBe('no-store')
    expect(result.getByText('凭据只显示这一次')).toBeTruthy()
    expect(within(result.getByTestId('copy-server_psk')).getByText('psk-1')).toBeTruthy()
    await user.click(result.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([planOp]))
    expect(await result.findByTestId('plan-review')).toBeTruthy()
  })

  it('向导：选项跟着协议变；生成的配置解析不了时不发 plan；重新生成换成新凭据', async () => {
    const user = userEvent.setup()
    let n = 0
    const calls = base({
      'GET /api/v1/inbound/build': () => {
        n++
        return { body: { server: 'hk-1', server_id: 1, spec: {}, credentials: { uuid: `uuid-${n}` }, plan_op: { op: 'create', kind: 'Inbound', spec: {} } } }
      },
    })
    renderApp('/proxy')
    await user.click(await (await findPanel()).findByRole('button', { name: '新建入站' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'VLESS' }))
    expect(dialog.getByLabelText('VLESS 流控')).toBeTruthy()
    expect(dialog.queryByLabelText('加密算法')).toBeNull()
    await user.click(dialog.getByRole('combobox', { name: '安全层' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['none', 'tls', 'reality'])
    await user.click(screen.getByRole('option', { name: 'reality' }))
    expect(dialog.getByLabelText('握手目标')).toBeTruthy()
    expect(dialog.queryByLabelText('证书路径')).toBeNull()
    await user.click(dialog.getByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    expect(dialog.getByLabelText('加密算法')).toBeTruthy()
    expect(dialog.queryByLabelText('VLESS 流控')).toBeNull()
    await user.type(dialog.getByLabelText('端口'), '8443')
    await user.click(dialog.getByRole('button', { name: '生成' }))
    expect(await dialog.findByText('uuid-1')).toBeTruthy()
    const config = dialog.getByLabelText('生成的配置')
    await user.clear(config)
    await user.type(config, '[1]')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('JSON 解析不了，或者不是一个对象。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    await user.click(dialog.getByRole('button', { name: '生成' }))
    expect(await dialog.findByText('uuid-2')).toBeTruthy()
    expect(dialog.queryByText('uuid-1')).toBeNull()
  })

  it('编辑入站只发改过的字段；没改时不发；填了 settings 时整体发出；提交后重新读取列表', async () => {
    const user = userEvent.setup()
    const calls = base({
      'GET /api/v1/inbound/get/5': { body: inbound(5) },
      'POST /api/v1/plan': { body: planView() },
      'POST /api/v1/apply': { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [] } },
    })
    renderApp('/proxy')
    await user.click(within(await screen.findByTestId('inbound-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('inbound-detail')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('没有改动。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    const port = dialog.getByLabelText('端口')
    await user.clear(port)
    await user.type(port, '8443')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'Inbound', id: 5, resourceVersion: 3, spec: { port: 8443 } }]))
    expect(dialog.getByText('已打码；留空不改，填写时整体替换。')).toBeTruthy()
    await user.click(dialog.getByLabelText('settings'))
    await user.paste('{"method":"none"}')
    await user.click(dialog.getAllByRole('button', { name: '预演' })[0]!)
    await waitFor(() => expect(planSpec(calls)[1]).toEqual({ op: 'update', kind: 'Inbound', id: 5, resourceVersion: 3, spec: { port: 8443, settings: { method: 'none' } } }))
    const before = inboundLists(calls).length
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    await waitFor(() => expect(inboundLists(calls).length).toBeGreaterThan(before))
  })

  it('删除与恢复：删除带当前版本；已删除的行只有「恢复」，带已删除对象的版本', async () => {
    const user = userEvent.setup()
    const calls = base({
      'GET /api/v1/inbound': (c: FakeCall) => page(query(c).get('include-deleted') ? [inbound(5), inbound(6, { metadata: { id: 6, resourceVersion: 5, deletedAt: '2026-11-22T10:00:00Z' } })] : [inbound(5)]),
      'POST /api/v1/plan': { body: planView() },
    })
    renderApp('/proxy')
    await user.click(within(await screen.findByTestId('inbound-row-5')).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'delete', kind: 'Inbound', id: 5, resourceVersion: 3 }]))
    expect(await screen.findByRole('dialog', { name: /删除入站 ss-5/ })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(panel().getByRole('switch', { name: '显示已删除' }))
    const row = within(await screen.findByTestId('inbound-row-6'))
    expect(row.getByText('已删除')).toBeTruthy()
    expect(row.queryByRole('button', { name: '查看' })).toBeNull()
    await user.click(row.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(planSpec(calls)[1]).toEqual({ op: 'restore', kind: 'Inbound', id: 6, resourceVersion: 5 }))
  })

  it('批量新建入站：servers 是勾选的名字、不带 all；全部服务器时只带 all；JSON 模板带 spec 原文；没选服务器时不能预演', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/inbound/batch/plan': { body: planView() } })
    renderApp('/proxy')
    await user.click(await (await findPanel()).findByRole('button', { name: '批量新建' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    await user.type(dialog.getByLabelText('端口'), '8443')
    expect((dialog.getByRole('button', { name: '预演' }) as HTMLButtonElement).disabled).toBe(true)
    await user.click(dialog.getByRole('checkbox', { name: 'hk-1' }))
    await user.click(dialog.getByRole('checkbox', { name: 'jp-1' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    const batches = () => calls.filter((c) => c.url === '/api/v1/inbound/batch/plan').map((c) => c.body as Record<string, unknown>)
    await waitFor(() => expect(batches()).toHaveLength(1))
    expect(batches()[0]).toMatchObject({ servers: ['hk-1', 'jp-1'], protocol: 'shadowsocks', port: 8443 })
    expect(batches()[0]).not.toHaveProperty('all')
    expect(dialog.getByText(/计划里的凭据是打码的，网页上看不到/)).toBeTruthy()
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
    await user.click(dialog.getByRole('switch', { name: '全部服务器' }))
    await user.click(dialog.getAllByRole('button', { name: '预演' })[0]!)
    await waitFor(() => expect(batches()).toHaveLength(2))
    expect(batches()[1]).toMatchObject({ all: true })
    expect(batches()[1]).not.toHaveProperty('servers')
    await user.click(dialog.getByRole('combobox', { name: '参数来源' }))
    await user.click(await screen.findByRole('option', { name: 'JSON 模板' }))
    await user.click(dialog.getByLabelText('入站模板（JSON）'))
    await user.paste('{"protocol":"socks","port":1080}')
    await user.click(dialog.getAllByRole('button', { name: '预演' })[0]!)
    await waitFor(() => expect(batches()).toHaveLength(3))
    expect(batches()[2]).toEqual({ all: true, spec: '{"protocol":"socks","port":1080}' })
  })
})

// 审查后补的几条（m2-18 复查）：向导的默认值、端口选填、提交后锁住、参数改过要重新生成、关闭前确认，编辑框的清空提示。
describe('代理页：入站向导与编辑的细节', () => {
  const build = (n: { value: number }) => () => {
    n.value++
    return { body: { server: 'hk-1', server_id: 1, spec: {}, credentials: { uuid: `uuid-${n.value}` }, plan_op: { op: 'create', kind: 'Inbound', spec: {} } } }
  }
  async function openWizard(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await (await findPanel()).findByRole('button', { name: '新建入站' }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'hk-1' }))
    return dialog
  }

  it('VLESS 加 tcp 默认安全层是 reality（与主控一致），换成 ws 后是 none；端口留空时不发 port', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/inbound/build': build({ value: 0 }) })
    renderApp('/proxy')
    const dialog = await openWizard(user)
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'VLESS' }))
    expect(dialog.getByRole('combobox', { name: '安全层' }).textContent).toBe('reality')
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await dialog.findByText('uuid-1')
    const first = query(calls.filter((c) => c.url.startsWith('/api/v1/inbound/build'))[0]!)
    expect([first.get('transport'), first.get('security'), first.has('port')]).toEqual(['tcp', 'reality', false])
    await user.click(dialog.getByRole('combobox', { name: '传输层' }))
    await user.click(await screen.findByRole('option', { name: 'ws' }))
    expect(dialog.getByRole('combobox', { name: '安全层' }).textContent).toBe('none')
    // 管理员自己选的安全层，换传输层时保留
    await user.click(dialog.getByRole('combobox', { name: '安全层' }))
    await user.click(await screen.findByRole('option', { name: 'tls' }))
    await user.click(dialog.getByRole('combobox', { name: '传输层' }))
    await user.click(await screen.findByRole('option', { name: 'grpc' }))
    expect(dialog.getByRole('combobox', { name: '安全层' }).textContent).toBe('tls')
  })

  it('生成之后改了参数：写明要重新生成、不能预演；只改「生成的配置」框照样能预演', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/inbound/build': build({ value: 0 }), 'POST /api/v1/plan': { body: planView() } })
    renderApp('/proxy')
    const dialog = await openWizard(user)
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await dialog.findByText('uuid-1')
    await user.click(dialog.getByLabelText('生成的配置'))
    await user.keyboard(' ')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/v1/plan')).toHaveLength(1))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
    await user.type(dialog.getByLabelText('端口'), '8443')
    expect(dialog.getByText('参数改过了，请重新生成。')).toBeTruthy()
    expect(dialog.queryByTestId('plan-review')).toBeNull()
    expect((dialog.getByRole('button', { name: '预演' }) as HTMLButtonElement).disabled).toBe(true)
    expect(dialog.getByText('uuid-1')).toBeTruthy()
  })

  it('提交之后向导锁住：没有「生成」，参数不能改，凭据还在', async () => {
    const user = userEvent.setup()
    const n = { value: 0 }
    const calls = base({
      'GET /api/v1/inbound/build': build(n),
      'POST /api/v1/plan': { body: planView() },
      'POST /api/v1/apply': { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [] } },
    })
    renderApp('/proxy')
    const dialog = await openWizard(user)
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await dialog.findByText('uuid-1')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('wizard-locked')).toBeTruthy()
    expect(dialog.queryByRole('button', { name: '生成' })).toBeNull()
    expect((dialog.getByLabelText('端口') as HTMLInputElement).disabled).toBe(true)
    expect(dialog.getByText('uuid-1')).toBeTruthy()
    expect(calls.filter((c) => c.url.startsWith('/api/v1/inbound/build'))).toHaveLength(1)
  })

  it('凭据显示着时按 Esc 先确认：取消后向导还在，确认后关掉', async () => {
    const user = userEvent.setup()
    base({ 'GET /api/v1/inbound/build': build({ value: 0 }) })
    renderApp('/proxy')
    const dialog = await openWizard(user)
    await user.click(await dialog.findByRole('combobox', { name: '协议' }))
    await user.click(await screen.findByRole('option', { name: 'Shadowsocks' }))
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await dialog.findByText('uuid-1')
    await user.keyboard('{Escape}')
    const confirm = within(await screen.findByRole('alertdialog'))
    expect(confirm.getByText('关闭之后，网页上再也看不到这次生成的凭据。')).toBeTruthy()
    await user.click(confirm.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByText('uuid-1')).toBeTruthy()
    await user.keyboard('{Escape}')
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('编辑：没打码的框写明要清空请填 {}；transport 填 {} 时发出空对象；tag 去掉两头空格', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/inbound/get/5': { body: inbound(5, {}, { transport: { type: 'ws', path: '/ws' } }) }, 'POST /api/v1/plan': { body: planView() } })
    renderApp('/proxy')
    await user.click(within(await screen.findByTestId('inbound-row-5')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('inbound-detail')
    expect(dialog.getAllByText('留空不改；要清空请填 {}。').length).toBe(2)
    const transport = dialog.getByLabelText('transport')
    await user.clear(transport)
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('没有改动。')).toBeTruthy()
    await user.click(transport)
    await user.paste('{}')
    const tag = dialog.getByLabelText('tag')
    await user.clear(tag)
    await user.type(tag, ' ss-new ')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'Inbound', id: 5, resourceVersion: 3, spec: { tag: 'ss-new', transport: {} } }]))
  })
})
