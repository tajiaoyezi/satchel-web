import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeXHR } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount, fakeServer, type FakeCall, type FakeReply } from '@/test/server'

const spec = { branding_site_title: '', branding_brand_title: 'Satchel', branding_logo_url: '', login_wallpaper: '', default_theme: 'flat' }
const status = {
  master_url: '',
  subscription_url: '',
  master_local_only: false,
  silent_mode: false,
  silent_mode_timeout: 15,
  probe_disguise_block_login: false,
  brute_force_enabled: true,
  brute_force_max_failures: 5,
  brute_force_window_minutes: 10,
  brute_force_block_minutes: 60,
  login_rate_max_attempts: 5,
  login_rate_window_minutes: 5,
  login_rate_lock_minutes: 15,
  skip_local_ip: true,
  turnstile_site_key: '1x00000000000000000000AA',
  turnstile_secret_key: '***',
  trusted_proxies: [],
  update_cdn_enabled: true,
}
const settings = (version = 4, patch: { spec?: object; status?: object } = {}) => ({
  apiVersion: 'satchel/v1',
  kind: 'SystemSettings',
  metadata: { resourceVersion: version },
  spec: { ...spec, ...patch.spec },
  status: { ...status, ...patch.status },
})

function server(extra: Record<string, FakeReply | ((call: FakeCall) => FakeReply)> = {}, account = adminAccount) {
  return fakeServer({
    'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
    'GET /api/v1/account/show': { body: account },
    'GET /api/v1/settings/show': { body: settings() },
    'GET /api/v1/settings/snapshots': { body: { items: [], total: 0, nextCursor: '' } },
    ...extra,
  })
}

beforeEach(() => {
  const boot = document.createElement('script')
  boot.id = 'satchel-boot'
  boot.type = 'application/json'
  boot.textContent = JSON.stringify({ site_title: '', brand_title: 'Satchel', logo_url: '', login_wallpaper: '', default_theme: 'flat' })
  document.head.appendChild(boot)
})

afterEach(() => {
  document.getElementById('satchel-boot')?.remove()
  delete window.turnstile
  vi.unstubAllGlobals()
})

// web-console「系统设置页」「后端的错误原样显示」「关掉更新 CDN 要确认」的组件部分。
describe('系统设置页', () => {
  it('改品牌后登录页变了：带读到的版本号保存，退出登录后登录页用新标题', async () => {
    const user = userEvent.setup()
    const calls = server({
      'POST /api/v1/settings/set': () => ({ body: settings(5, { spec: { branding_brand_title: '测试面板' } }) }),
      'DELETE /api/v1/session': { body: { logged_out: true } },
      'GET /api/v1/session/captcha': { body: { enabled: false, site_key: '' } },
    })
    renderApp('/settings')
    const brand = await screen.findByLabelText('品牌标题（登录页与导航上的名字）')
    await user.clear(brand)
    await user.type(brand, '测试面板')
    await user.click(screen.getByRole('button', { name: '保存品牌与外观' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/settings/set')).toBe(true))
    expect(calls.find((c) => c.url === '/api/v1/settings/set')?.body).toEqual({ set: { ...spec, branding_brand_title: '测试面板' }, 'resource-version': 4 })
    expect(await screen.findByText('当前版本 5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '账号' }))
    await user.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    expect(await screen.findByText('测试面板', { selector: '[data-slot="card-title"]' })).toBeTruthy()
  })

  it('版本冲突：提示别人刚改过，重新读取后用新版本号，不自动覆盖', async () => {
    const user = userEvent.setup()
    let version = 4
    const calls = server({
      'GET /api/v1/settings/show': () => ({ body: settings(version) }),
      'POST /api/v1/settings/set': (call) =>
        (call.body as { 'resource-version': number })['resource-version'] === version
          ? { body: settings(++version) }
          : { status: 409, body: { code: 'version_conflict', reason: '系统设置已被改过（当前版本 5）', state: { resourceVersion: 5 }, next: '重新读取后再改' } },
    })
    renderApp('/settings')
    await screen.findByText('当前版本 4')
    version = 5 // 有人经 CLI 改了一个设置
    await user.click(screen.getByRole('button', { name: '保存品牌与外观' }))
    expect(await screen.findByText('系统设置已被改过（当前版本 5）')).toBeTruthy()
    expect(screen.getByText('别人刚改过系统设置。请重新读取，看过最新的值后再改。')).toBeTruthy()
    expect(calls.filter((c) => c.url === '/api/v1/settings/set')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByText('当前版本 5')).toBeTruthy()
    expect(screen.queryByText('系统设置已被改过（当前版本 5）')).toBeNull()
    await user.click(screen.getByRole('button', { name: '保存品牌与外观' }))
    expect(await screen.findByText('当前版本 6')).toBeTruthy()
    expect(calls.filter((c) => c.url === '/api/v1/settings/set').map((c) => (c.body as { 'resource-version': number })['resource-version'])).toEqual([4, 5])
  })

  it('后端的错误原样显示：logo 地址不合规时显示主控的 reason', async () => {
    const user = userEvent.setup()
    server({
      'POST /api/v1/settings/set': { status: 400, body: { code: 'bad_request', reason: '字段 branding_logo_url 非空时须以 /、http://、https:// 或 data:image/ 开头', state: {}, next: '' } },
    })
    renderApp('/settings')
    await user.type(await screen.findByLabelText('logo 地址'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: '保存品牌与外观' }))
    expect(await screen.findByText('字段 branding_logo_url 非空时须以 /、http://、https:// 或 data:image/ 开头')).toBeTruthy()
    expect(screen.getByText('当前版本 4')).toBeTruthy()
  })

  it('关掉更新 CDN 要确认：确认后 confirm 为 false', async () => {
    const user = userEvent.setup()
    const calls = server({
      'POST /api/v1/settings/update-cdn/set/false': { body: settings(5, { status: { update_cdn_enabled: false } }) },
    })
    renderApp('/settings')
    await user.click(await screen.findByRole('switch', { name: '使用更新 CDN' }))
    expect(await screen.findByText('关掉更新 CDN')).toBeTruthy()
    expect(calls.some((c) => c.url.includes('update-cdn'))).toBe(false)
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '使用更新 CDN' })).not.toBeChecked())
    expect(calls.find((c) => c.url === '/api/v1/settings/update-cdn/set/false')?.body).toEqual({ confirm: 'false', 'resource-version': 4 })
  })

  it('门与登录防护：打开静默模式先提醒，当场验证后整组保存，打码的 secret key 显示与交回都是 ***', async () => {
    const user = userEvent.setup()
    // 管理员会话带 secrets scope，settings show 给的是原文；页面上不显示它
    const calls = server({
      'GET /api/v1/settings/show': { body: settings(4, { status: { turnstile_secret_key: 'real-secret-value' } }) },
      'POST /api/v1/settings/gates/set': { body: settings(5, { status: { silent_mode: true, turnstile_secret_key: 'real-secret-value' } }) },
    })
    const { container } = renderApp('/settings')
    expect(await screen.findByLabelText(/^secret key/)).toHaveValue('***')
    expect(container.innerHTML).not.toContain('real-secret-value')
    await user.click(await screen.findByRole('switch', { name: '静默模式' }))
    await user.click(screen.getByRole('button', { name: '保存门与登录防护' }))
    expect(await screen.findByText('保存后可能马上进不去')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '仍然保存' }))
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/settings/gates/set')).toBe(true))
    const body = calls.find((c) => c.url === '/api/v1/settings/gates/set')?.body as { set: Record<string, unknown> }
    expect(body).toMatchObject({ 'resource-version': 4, 'verify-password': 'secret12' })
    expect(body.set).toMatchObject({ silent_mode: true, turnstile_secret_key: '***', turnstile_site_key: '1x00000000000000000000AA', silent_mode_timeout: '15', trusted_proxies: '[]' })
  })

  it('测试 Turnstile 配置：用已保存的 site key 显示组件，拿到 token 后显示核对结果', async () => {
    const user = userEvent.setup()
    const render = vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
      ;(opts.callback as (token: string) => void)('XXXX.DUMMY.TOKEN')
      return 'w1'
    })
    window.turnstile = { render, remove: vi.fn() }
    const calls = server({
      'POST /api/v1/settings/turnstile/test': { body: { success: true, error_codes: [], hostname: 'example.com' } },
    })
    renderApp('/settings')
    await user.click(await screen.findByRole('button', { name: '测试配置' }))
    expect(await screen.findByText('核对通过')).toBeTruthy()
    expect(screen.getByText('hostname：example.com')).toBeTruthy()
    expect(render.mock.calls[0][1]).toMatchObject({ sitekey: '1x00000000000000000000AA' })
    expect(calls.find((c) => c.url === '/api/v1/settings/turnstile/test')?.body).toEqual({ response: 'XXXX.DUMMY.TOKEN' })
  })

  it('没保存两个 key 时测试按钮不可用并说明原因', async () => {
    server({ 'GET /api/v1/settings/show': { body: settings(4, { status: { turnstile_secret_key: '' } }) } })
    renderApp('/settings')
    expect(await screen.findByRole('button', { name: '测试配置' })).toBeDisabled()
    expect(screen.getByText('先保存 site key 与 secret key，才能测试配置。')).toBeTruthy()
  })

  it('普通用户看不到系统设置：导航里没有系统设置与运维菜单，直接打开 /settings 与 /logs 都显示没有权限，也不读', async () => {
    const calls = server({}, { ...adminAccount, username: 'bob', role: 'user' })
    const { router } = renderApp('/settings')
    expect(await screen.findByText('这一页只对管理员开放。')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '系统设置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '运维' })).toBeNull()
    await router.navigate({ to: '/logs' })
    expect(await screen.findByRole('heading', { name: '日志' })).toBeTruthy()
    expect(screen.getByText('这一页只对管理员开放。')).toBeTruthy()
    expect(calls.some((c) => c.url.startsWith('/api/v1/settings') || c.url.startsWith('/api/v1/logs'))).toBe(false)
  })

  it('上传 logo：以文件本身作请求体，地址填进输入框并预览，保存时带上这个地址', async () => {
    const user = userEvent.setup()
    const sent = fakeXHR({ status: 200, body: { url: '/public/uploads/0123456789abcdef0123456789abcdef.png', size: 3, content_type: 'image/png' } })
    const calls = server({ 'POST /api/v1/settings/set': { body: settings(5, { spec: { branding_logo_url: '/public/uploads/0123456789abcdef0123456789abcdef.png' } }) } })
    renderApp('/settings')
    const file = new File(['PNG'], 'logo.png', { type: 'image/png' })
    await user.upload(await screen.findByTestId('branding_logo_url-file'), file)
    await waitFor(() => expect(screen.getByLabelText('logo 地址')).toHaveValue('/public/uploads/0123456789abcdef0123456789abcdef.png'))
    expect(sent).toEqual({ url: '/api/v1/settings/image/upload', type: 'application/octet-stream', body: file })
    expect(screen.getAllByRole('img', { name: '预览' })[0]).toHaveAttribute('src', '/public/uploads/0123456789abcdef0123456789abcdef.png')
    await user.click(screen.getByRole('button', { name: '保存品牌与外观' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/settings/set')).toBe(true))
    expect((calls.find((c) => c.url === '/api/v1/settings/set')?.body as { set: Record<string, string> }).set.branding_logo_url).toBe('/public/uploads/0123456789abcdef0123456789abcdef.png')
  })

  it('上传了主控不收的图片：显示主控的 reason，壁纸输入框不变', async () => {
    const user = userEvent.setup({ applyAccept: false })
    fakeXHR({ status: 400, body: { code: 'bad_request', reason: '只收 PNG、JPEG、GIF、WebP 与 ICO 图片（按文件内容判断，不收 SVG），这个文件是 text/xml; charset=utf-8', state: {}, next: '' } })
    server({ 'GET /api/v1/settings/show': { body: settings(4, { spec: { login_wallpaper: 'https://img.example/a.jpg' } }) } })
    renderApp('/settings')
    await user.upload(await screen.findByTestId('login_wallpaper-file'), new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }))
    expect(await screen.findByText(/只收 PNG、JPEG、GIF、WebP 与 ICO 图片/)).toBeTruthy()
    expect(screen.getByLabelText('登录壁纸地址')).toHaveValue('https://img.example/a.jpg')
  })
})
