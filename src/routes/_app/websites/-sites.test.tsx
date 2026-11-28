import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { planView, servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import { adminAccount, type FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const website = (id: number, spec: object = {}, patch: object = {}) => ({
  apiVersion: 'satchel/v1',
  kind: 'Website',
  metadata: { id, resourceVersion: 2 },
  spec: { server_id: 1, domain: `s${id}.example.com`, type: 'static', target: '/var/www/a', certificate_id: null, use_443: false, ...spec },
  status: { scanned: { listen_ports: ['80'] }, managed: true, conf_path: `/etc/nginx/servers/s${id}.example.com.conf` },
  server_name: 'hk-1',
  ...patch,
})

const templates = {
  templates: [
    { id: 'static', type: 'static', display_name: '静态站', description: '托管本地静态目录', target_format: '/var/www/<dir>', example_target: '/var/www/site' },
    { id: 'decoy-landing', type: 'decoy', display_name: '伪装站 · 门户首页', description: '门户占位页', target_format: 'landing', example_target: 'landing' },
    { id: 'decoy-blog', type: 'decoy', display_name: '伪装站 · 博客', description: '博客占位页', target_format: 'blog', example_target: 'blog' },
  ],
  rules: ['域名只能是合法的主机名'],
}

const build = (patch: object = {}) => ({
  body: {
    server: 'hk-1',
    server_id: 1,
    same_host_as_master: false,
    spec: {},
    conf_path: '/etc/nginx/servers/app.example.com.conf',
    preview_conf: '# satchel-managed: website app.example.com\nserver { listen 80; }',
    plan_op: { op: 'create', kind: 'Website', spec: { server_id: 1, domain: 'app.example.com', type: 'proxy', target: 'http://127.0.0.1:8080', certificate_id: null, use_443: false } },
    ...patch,
  },
})

const siteLists = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/v1/website')
const planSpec = (calls: FakeCall[]) => calls.filter((c) => c.url === '/api/v1/plan').map((c) => JSON.parse((c.body as { spec: string }).spec) as unknown)

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/website': page([website(3)]),
    'GET /api/v1/website/get/3': { body: website(3) },
    'GET /api/v1/website/templates': { body: templates },
    'POST /api/v1/plan': { body: planView() },
    ...(routes as Record<string, never>),
  })

const findSites = async () => within(await screen.findByRole('tabpanel', { name: '站点' }))

async function pickServer(user: ReturnType<typeof userEvent.setup>, name: string, scope: ReturnType<typeof within> | typeof screen = screen) {
  await user.click(scope.getByRole('combobox', { name: '服务器' }))
  await user.click(await screen.findByRole('option', { name }))
}

// web-console「网站页」的站点部分与「布局与导航」的「网站页只对管理员显示」（m2-22）。
describe('网站页：站点', () => {
  it('普通用户直接打开 /websites：显示没有权限，不请求站点与服务器', async () => {
    const calls = opsServer({}, { ...adminAccount, username: 'bob', role: 'user' })
    renderApp('/websites')
    expect(await screen.findByText('这一页只对管理员开放。')).toBeTruthy()
    expect(calls.some((c) => c.url.startsWith('/api/v1/website') || c.url.startsWith('/api/v1/server'))).toBe(false)
  })

  it('按服务器看站点：请求带 server-name 与 type，打开「显示已删除」后带 include-deleted；翻页带 cursor', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/website': (c: FakeCall) => (query(c).get('cursor') === '50' ? page([website(9)]) : page([website(3)], '50')) })
    renderApp('/websites')
    const tab = await findSites()
    const row = within(await tab.findByTestId('website-row-3'))
    expect(row.getByText('s3.example.com')).toBeTruthy()
    expect(row.getByText('静态站')).toBeTruthy()
    expect(row.getByText('/etc/nginx/servers/s3.example.com.conf')).toBeTruthy()
    await user.click(tab.getByRole('button', { name: '加载更多' }))
    expect(await tab.findByTestId('website-row-9')).toBeTruthy()
    expect(siteLists(calls).some((c) => query(c).get('cursor') === '50')).toBe(true)
    await pickServer(user, 'hk-1')
    await user.click(tab.getByRole('combobox', { name: '按类型过滤' }))
    await user.click(await screen.findByRole('option', { name: '反代' }))
    await waitFor(() => expect(siteLists(calls).some((c) => query(c).get('server-name') === 'hk-1' && query(c).get('type') === 'proxy')).toBe(true))
    await user.click(tab.getByRole('switch', { name: '显示已删除' }))
    await waitFor(() =>
      expect(siteLists(calls).some((c) => query(c).get('server-name') === 'hk-1' && query(c).get('type') === 'proxy' && query(c).get('include-deleted') === 'true')).toBe(true),
    )
  })

  it('编辑站点只发改过的字段；没有改动时提示、不发请求；详情显示纳管状态与证书编号', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/websites')
    const tab = await findSites()
    await user.click(within(await tab.findByTestId('website-row-3')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    const detail = within(await dialog.findByTestId('website-detail'))
    expect(detail.getByText('/etc/nginx/servers/s3.example.com.conf')).toBeTruthy()
    expect(detail.getByText(/"listen_ports"/)).toBeTruthy()
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText('没有改动。')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    const target = dialog.getByLabelText('目标')
    await user.clear(target)
    await user.type(target, ' /var/www/b ')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'Website', id: 3, resourceVersion: 2, spec: { target: '/var/www/b' } }]))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('编辑提交后：版本变了、表单重新读取，节点结果仍然显示，列表重新读取', async () => {
    const user = userEvent.setup()
    let rv = 2
    const calls = base({
      'GET /api/v1/website/get/3': () => ({ body: website(3, {}, { metadata: { id: 3, resourceVersion: rv } }) }),
      'POST /api/v1/apply': () => {
        rv = 3
        return { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'h2', websites_applied: ['s3.example.com'] }] } }
      },
    })
    renderApp('/websites')
    const tab = await findSites()
    await user.click(within(await tab.findByTestId('website-row-3')).getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    await dialog.findByTestId('website-detail')
    await user.click(dialog.getByRole('switch', { name: '直接监听 443' }))
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'update', kind: 'Website', id: 3, resourceVersion: 2, spec: { use_443: true } }]))
    const before = siteLists(calls).length
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('apply-server-hk-1')).toBeTruthy()
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/v1/website/get/3').length).toBe(2))
    await waitFor(() => expect(siteLists(calls).length).toBeGreaterThan(before))
    expect(dialog.getByTestId('apply-nginx-hk-1').textContent).toContain('写入站点：s3.example.com')
    expect(dialog.getByRole('switch', { name: '直接监听 443' }).getAttribute('aria-checked')).toBe('false')
  })

  it('删除带读到的版本号；恢复带已删除对象的版本号', async () => {
    const user = userEvent.setup()
    const calls = base({
      'GET /api/v1/website': (c: FakeCall) =>
        page(query(c).get('include-deleted') === 'true' ? [website(3), website(8, {}, { metadata: { id: 8, resourceVersion: 5, deletedAt: '2026-11-22T10:00:00Z' } })] : [website(3)]),
    })
    renderApp('/websites')
    const tab = await findSites()
    await user.click(within(await tab.findByTestId('website-row-3')).getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog', { name: '删除站点 s3.example.com（#3）' })).toBeTruthy()
    await waitFor(() => expect(planSpec(calls)).toEqual([{ op: 'delete', kind: 'Website', id: 3, resourceVersion: 2 }]))
    await user.keyboard('{Escape}')
    await user.click(tab.getByRole('switch', { name: '显示已删除' }))
    const row = within(await tab.findByTestId('website-row-8'))
    expect(row.getByText('已删除')).toBeTruthy()
    expect(row.queryByRole('button', { name: '查看' })).toBeNull()
    await user.click(row.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(planSpec(calls)[1]).toEqual({ op: 'restore', kind: 'Website', id: 8, resourceVersion: 5 }))
  })
})

describe('网站页：向导', () => {
  it('向导生成并预演：请求带填了的参数、不带 use-443；页面显示预览配置；预演的 spec 是 plan_op', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/website/build': build() })
    renderApp('/websites')
    const tab = await findSites()
    await user.click(tab.getByRole('button', { name: '新建站点' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建站点' }))
    expect(dialog.getByRole('button', { name: '生成' })).toHaveProperty('disabled', true)
    await pickServer(user, 'hk-1', dialog)
    await user.type(dialog.getByLabelText('域名'), ' app.example.com ')
    await user.click(dialog.getByRole('combobox', { name: '类型' }))
    await user.click(await screen.findByRole('option', { name: '反代' }))
    await user.type(dialog.getByLabelText('目标'), 'http://127.0.0.1:8080')
    await user.type(dialog.getByLabelText('WebSocket 路径'), '/ws')
    await user.click(dialog.getByRole('button', { name: '生成' }))
    expect(await dialog.findByTestId('website-preview')).toBeTruthy()
    const b = calls.find((c) => c.url.startsWith('/api/v1/website/build'))!
    expect(Object.fromEntries(query(b))).toEqual({ 'server-name': 'hk-1', domain: 'app.example.com', type: 'proxy', target: 'http://127.0.0.1:8080', 'wss-path': '/ws' })
    expect(dialog.getByTestId('website-preview').textContent).toContain('# satchel-managed: website app.example.com')
    expect(dialog.getByText('/etc/nginx/servers/app.example.com.conf')).toBeTruthy()
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(planSpec(calls)).toEqual([build().body.plan_op]))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('伪装站：模板按钮填入模板名；生成之后改了参数，「预演」禁用并提示重新生成；同机服务器写明不能监听 443 与要当场验证', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/website/build': build({ same_host_as_master: true, requires_human: true }) })
    renderApp('/websites')
    const tab = await findSites()
    await pickServer(user, 'hk-1')
    await user.click(tab.getByRole('button', { name: '新建站点' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建站点' }))
    expect(dialog.getByRole('combobox', { name: '服务器' }).textContent).toBe('hk-1')
    await user.type(dialog.getByLabelText('域名'), 'app.example.com')
    await user.click(dialog.getByRole('combobox', { name: '类型' }))
    await user.click(await screen.findByRole('option', { name: '伪装站' }))
    await user.click(await dialog.findByRole('button', { name: '伪装站 · 博客' }))
    expect((dialog.getByLabelText('目标') as HTMLInputElement).value).toBe('blog')
    expect(dialog.queryByRole('button', { name: '静态站' })).toBeNull()
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await dialog.findByTestId('website-preview')
    expect(query(calls.find((c) => c.url.startsWith('/api/v1/website/build'))!).get('target')).toBe('blog')
    expect(dialog.getByText('这台服务器与主控同机，不能直接监听 443。')).toBeTruthy()
    expect(dialog.getByText('这台服务器与主控同机，提交时要当场验证密码与两步验证码。')).toBeTruthy()
    await user.type(dialog.getByLabelText('域名'), 'x')
    expect(dialog.getByText('参数改过了，请重新生成。')).toBeTruthy()
    expect(dialog.getByRole('button', { name: '预演' })).toHaveProperty('disabled', true)
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
  })

  it('提交之后向导锁住：字段不能改，「生成」与「预演」不再出现，提交结果还在', async () => {
    const user = userEvent.setup()
    base({
      'GET /api/v1/website/build': build(),
      'POST /api/v1/apply': { body: { plan_id: 7, apply_id: 'ap-1', affected_count: 1, objects: [], servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'h2' }] } },
    })
    renderApp('/websites')
    const tab = await findSites()
    await user.click(tab.getByRole('button', { name: '新建站点' }))
    const dialog = within(await screen.findByRole('dialog', { name: '新建站点' }))
    await pickServer(user, 'hk-1', dialog)
    await user.type(dialog.getByLabelText('域名'), 'app.example.com')
    await user.click(dialog.getByRole('button', { name: '生成' }))
    await user.click(await dialog.findByRole('button', { name: '预演' }))
    await user.click(await dialog.findByRole('button', { name: '提交' }))
    expect(await dialog.findByTestId('apply-server-hk-1')).toBeTruthy()
    expect(dialog.getByTestId('website-wizard-locked')).toBeTruthy()
    expect(dialog.queryByRole('button', { name: '生成' })).toBeNull()
    expect(dialog.queryByRole('button', { name: '预演' })).toBeNull()
    expect(dialog.getByLabelText('域名').matches(':disabled')).toBe(true)
    // 下拉框不看外层 fieldset，自己也要禁用
    expect(dialog.getByRole('combobox', { name: '服务器' })).toHaveProperty('disabled', true)
    expect(dialog.getByRole('combobox', { name: '类型' })).toHaveProperty('disabled', true)
  })
})
