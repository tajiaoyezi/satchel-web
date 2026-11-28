import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const scanResult = {
  server: 'hk-1',
  server_id: 1,
  total: 2,
  managed: [
    { website_id: 3, domain: 'app.example.com', conf_path: '/etc/nginx/servers/app.example.com.conf', managed: true, type: 'static', listen_ports: ['80', '443'], has_ssl: true },
    // 同域名的手写配置也在 managed 数组里，managed 为假
    { website_id: 3, domain: 'app.example.com', conf_path: '/etc/nginx/sites-enabled/app', managed: false, type: 'static', listen_ports: ['8080'], has_ssl: false },
  ],
  unmanaged: [{ domain: 'legacy.example.com', conf_path: '/etc/nginx/conf.d/legacy.conf', managed: false, type: 'proxy', listen_ports: ['80'], has_ssl: false, proxy_pass: 'http://127.0.0.1:9000' }],
  missing: ['gone.example.com'],
  scanned_at: '2026-11-28T10:00:00Z',
}

const validateResult = {
  server: 'hk-1',
  domain: 'www.example.com',
  port: 443,
  sni: 'www.example.com',
  ok: true,
  reachable: true,
  latency_ms: 42,
  tls_version: 'TLS 1.3',
  alpn: 'h2',
  http2: true,
  cert_valid: true,
  cert_subject: 'CN=www.example.com',
  cert_issuer: "CN=Let's Encrypt",
  cert_dns_names: ['www.example.com', 'example.com'],
  cert_expires_at: '2027-01-01T00:00:00Z',
  cert_days_left: 34,
  http_status: 200,
  server_header: 'nginx',
  reality_suitable: true,
  checked_at: '2026-11-28T10:00:00Z',
}

const templates = {
  templates: [{ id: 'decoy-landing', type: 'decoy', display_name: '伪装站 · 门户首页', description: '门户占位页', target_format: 'landing', example_target: 'landing' }],
  rules: ['未纳管的配置文件绝不覆盖'],
}

const siteLists = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/v1/website')

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/website': page([]),
    'GET /api/v1/website/templates': { body: templates },
    ...(routes as Record<string, never>),
  })

async function open(user: ReturnType<typeof userEvent.setup>, tabName: string) {
  await user.click(await screen.findByRole('tab', { name: tabName }))
  return within(await screen.findByRole('tabpanel', { name: tabName }))
}

async function pickServer(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: '服务器' }))
  await user.click(await screen.findByRole('option', { name }))
}

// web-console「网站页」的扫描、校验与模板（m2-22）。
describe('网站页：扫描、校验与模板', () => {
  it('没选服务器时不扫描、不校验：提示先选一台服务器，按钮不可点', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/websites')
    const scan = await open(user, '扫描')
    expect(scan.getByText('先在上面选一台服务器。')).toBeTruthy()
    expect(scan.getByRole('button', { name: '扫描' })).toHaveProperty('disabled', true)
    const validate = await open(user, '校验')
    await user.type(validate.getByLabelText('域名'), 'www.example.com')
    expect(validate.getByRole('button', { name: '校验' })).toHaveProperty('disabled', true)
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('扫描结果：分别列出已纳管、未纳管与磁盘上没有的站点，写明未纳管的不会被改动；同域名的手写配置标明不是 Satchel 生成的；之后站点列表重新读取', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/website/scan/hk-1': { body: scanResult } })
    renderApp('/websites')
    await screen.findByRole('tabpanel', { name: '站点' })
    await pickServer(user, 'hk-1')
    const tab = await open(user, '扫描')
    const before = siteLists(calls).length
    await user.click(tab.getByRole('button', { name: '扫描' }))
    const result = within(await tab.findByTestId('scan-result'))
    expect(calls.find((c) => c.url === '/api/v1/website/scan/hk-1')?.method).toBe('POST')
    const generated = within(result.getByTestId('scan-row-/etc/nginx/servers/app.example.com.conf'))
    expect(generated.getByText('80, 443')).toBeTruthy()
    expect(generated.getAllByText('是')).toHaveLength(2) // Satchel 生成、SSL
    const handwritten = within(result.getByTestId('scan-row-/etc/nginx/sites-enabled/app'))
    expect(handwritten.getByText('8080')).toBeTruthy()
    expect(handwritten.getAllByText('否')).toHaveLength(2)
    expect(result.getByRole('columnheader', { name: 'Satchel 生成' })).toBeTruthy()
    const unmanaged = within(result.getByTestId('scan-unmanaged'))
    expect(unmanaged.getByText('legacy.example.com')).toBeTruthy()
    expect(unmanaged.getByText('http://127.0.0.1:9000')).toBeTruthy()
    expect(unmanaged.getByText('这些配置文件不是 Satchel 生成的，主控不会改动或删除它们。')).toBeTruthy()
    expect(result.getByText('库里有、磁盘上没有：gone.example.com')).toBeTruthy()
    await waitFor(() => expect(siteLists(calls).length).toBeGreaterThan(before))
  })

  it('扫描时节点不在线：原样显示主控的 reason；换一台服务器后不留上一台的结果', async () => {
    const user = userEvent.setup()
    base({
      'POST /api/v1/website/scan/hk-1': { status: 503, body: { code: 'unavailable', reason: '节点 hk-1 不在线', state: {}, next: '' } },
      'POST /api/v1/website/scan/jp-1': { body: { ...scanResult, server: 'jp-1' } },
    })
    renderApp('/websites')
    await screen.findByRole('tabpanel', { name: '站点' })
    await pickServer(user, 'jp-1')
    let tab = await open(user, '扫描')
    await user.click(tab.getByRole('button', { name: '扫描' }))
    expect(await tab.findByTestId('scan-result')).toBeTruthy()
    await pickServer(user, 'hk-1')
    tab = within(await screen.findByRole('tabpanel', { name: '扫描' }))
    expect(tab.queryByTestId('scan-result')).toBeNull()
    await user.click(tab.getByRole('button', { name: '扫描' }))
    expect(await tab.findByText('节点 hk-1 不在线')).toBeTruthy()
  })

  it('校验远程站点：请求体带 domain、默认端口 443 与超时 10s，SNI 留空不发；显示能否用作 Reality 握手目标', async () => {
    const user = userEvent.setup()
    const calls = base({ 'POST /api/v1/website/validate/hk-1': { body: validateResult } })
    renderApp('/websites')
    await screen.findByRole('tabpanel', { name: '站点' })
    await pickServer(user, 'hk-1')
    const tab = await open(user, '校验')
    await user.type(tab.getByLabelText('域名'), ' www.example.com ')
    await user.click(tab.getByRole('button', { name: '校验' }))
    const result = within(await tab.findByTestId('validate-result'))
    expect(calls.find((c) => c.url === '/api/v1/website/validate/hk-1')?.body).toEqual({ domain: 'www.example.com', port: 443, timeout: '10s' })
    expect(result.getByText('适合')).toBeTruthy()
    expect(result.getByText('TLS 1.3')).toBeTruthy()
    expect(result.getByText('42 ms')).toBeTruthy()
    expect(result.getByText('www.example.com, example.com')).toBeTruthy()
  })

  it('「模板」第一次打开之前不请求；打开后列出模板与安全规则', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/websites')
    await screen.findByRole('tabpanel', { name: '站点' })
    await waitFor(() => expect(siteLists(calls).length).toBeGreaterThan(0))
    expect(calls.some((c) => c.url === '/api/v1/website/templates')).toBe(false)
    const tab = await open(user, '模板')
    const row = within(await tab.findByTestId('template-decoy-landing'))
    expect(row.getByText('伪装站 · 门户首页')).toBeTruthy()
    expect(row.getByText('伪装站')).toBeTruthy()
    expect(tab.getByText('未纳管的配置文件绝不覆盖')).toBeTruthy()
  })
})
