import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { matrix, servers } from '@/test/proxy'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const example = { id: 'vless-reality', title: 'VLESS + Reality', protocol: 'vless', transport: 'tcp', security: 'reality', description: '示例说明', spec: {}, plan_op: { op: 'create', kind: 'Inbound', spec: { tag: 'vless-reality' } } }

const base = (routes: Record<string, unknown> = {}) =>
  opsServer({
    'GET /api/v1/server': servers,
    'GET /api/v1/inbound': page([]),
    'GET /api/v1/outbound': page([]),
    'GET /api/v1/inbound/batch': page([{ id: 1, batch_id: 'batch-abc', server_id: 2, tag: 'ss-8443', protocol: 'shadowsocks', port: 8443, created_at: '2026-11-22T10:00:00Z' }]),
    'GET /api/v1/outbound/batch': page([]),
    'GET /api/v1/inbound/protocols': { body: matrix },
    'GET /api/v1/inbound/examples': { body: { items: [example], total: 1 } },
    ...(routes as Record<string, never>),
  })

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('tab', { name }))
  return within(await screen.findByRole('tabpanel', { name }))
}

// web-console「代理页」的批次记录与参考（m2-18）。
describe('代理页：批次记录与参考', () => {
  it('协议矩阵与示例：打开「参考」之前不请求；之后列出协议、并行移植线与示例，示例写明密钥是占位值，按协议筛选带 protocol', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    await screen.findByRole('tab', { name: '参考' })
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/inbound?'))).toBe(true))
    expect(calls.some((c) => c.url.startsWith('/api/v1/inbound/protocols') || c.url.startsWith('/api/v1/inbound/examples'))).toBe(false)
    const tab = await openTab(user, '参考')
    expect(within(await tab.findByTestId('protocol-vless')).getByText('tcp, ws, grpc')).toBeTruthy()
    expect(tab.getByText('xhttp：XHTTP 归并行协议移植线')).toBeTruthy()
    expect(tab.getByText('mKCP（已淘汰）')).toBeTruthy()
    expect(await tab.findByTestId('example-vless-reality')).toBeTruthy()
    expect(tab.getByText(/示例里的密钥是固定的占位值/)).toBeTruthy()
    await user.type(tab.getByLabelText('协议'), 'vless')
    await user.click(tab.getByRole('button', { name: '查询' }))
    await waitFor(() => expect(calls.some((c: FakeCall) => c.url.startsWith('/api/v1/inbound/examples?') && query(c).get('protocol') === 'vless')).toBe(true))
  })

  it('密钥生成：点了才请求，带 type，不进缓存，显示生成的值', async () => {
    const user = userEvent.setup()
    const calls = base({ 'GET /api/v1/inbound/keygen': { body: { type: 'uuid', uuid: '6a4f1c2e-0000-4000-8000-000000000001' } } })
    renderApp('/proxy')
    const tab = await openTab(user, '参考')
    expect(calls.some((c) => c.url.startsWith('/api/v1/inbound/keygen'))).toBe(false)
    await user.click(tab.getByRole('combobox', { name: '类型' }))
    await user.click(await screen.findByRole('option', { name: 'UUID' }))
    expect(tab.queryByRole('combobox', { name: 'SS2022 算法' })).toBeNull()
    await user.click(tab.getByRole('button', { name: '生成' }))
    const result = within(await tab.findByTestId('keygen-result'))
    expect(result.getByText('6a4f1c2e-0000-4000-8000-000000000001')).toBeTruthy()
    expect(result.queryByText('uuid')).toBeNull()
    const call = calls.find((c) => c.url.startsWith('/api/v1/inbound/keygen'))!
    expect(query(call).get('type')).toBe('uuid')
    expect(query(call).has('cipher')).toBe(false)
    expect(call.cache).toBe('no-store')
  })

  it('批次记录：按批次编号过滤带 batch-id，选了服务器时带 server-name；服务器按名字显示', async () => {
    const user = userEvent.setup()
    const calls = base()
    renderApp('/proxy')
    const tab = await openTab(user, '批次记录')
    const inbounds = within(await tab.findByTestId('inbound-batches'))
    expect(await inbounds.findByText('batch-abc')).toBeTruthy()
    expect(inbounds.getByText('jp-1')).toBeTruthy()
    await user.type(inbounds.getByLabelText('批次编号'), 'batch-abc')
    await user.click(inbounds.getByRole('button', { name: '查询' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/inbound/batch?') && query(c).get('batch-id') === 'batch-abc')).toBe(true))
    await user.click(screen.getByRole('combobox', { name: '服务器' }))
    await user.click(await screen.findByRole('option', { name: 'jp-1' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/outbound/batch?') && query(c).get('server-name') === 'jp-1')).toBe(true))
  })
})
