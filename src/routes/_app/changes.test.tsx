import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount, type FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const planView = (patch: object = {}) => ({
  plan_id: 7,
  status: 'pending',
  affected_count: 1,
  expires_at: '2026-11-22T10:10:00Z',
  created_at: '2026-11-22T10:00:00Z',
  required_dangers: [],
  objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', field_diff: { region: { before: '', after: '东京' } } }],
  servers: [],
  ...patch,
})

const summary = (id: number, status: string) => ({ id, status, affected_count: 1, expires_at: '2026-11-22T10:10:00Z', created_at: '2026-11-22T10:00:00Z' })
const snapshot = (id: number, applyId = 'ap-1') => ({ id, object_kind: 'Server', object_id: 1, object_version: 3, content_hash: 'h', source: 'apply', status: 'active', apply_id: applyId, created_at: '2026-11-22T10:00:00Z' })

// web-console「配置变更页」（m2-16）。
describe('配置变更页', () => {
  it('计划列表与详情：列出编号与状态；点开请求 plans get，显示对象并有提交', async () => {
    const user = userEvent.setup()
    const calls = opsServer({ 'GET /api/v1/plans': page([summary(7, 'pending')]), 'GET /api/v1/plans/get/7': { body: planView() } })
    renderApp('/changes')
    const row = within(await screen.findByTestId('plan-row-7'))
    expect(row.getByText('待提交')).toBeTruthy()
    await user.click(row.getByRole('button', { name: '查看' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByTestId('plan-field-region')).toBeTruthy()
    expect(dialog.getByRole('button', { name: '提交' })).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plans/get/7')).toBe(true)
  })

  it('按状态过滤：请求带 status', async () => {
    const user = userEvent.setup()
    const calls = opsServer({ 'GET /api/v1/plans': page([]) })
    renderApp('/changes')
    await user.click(await screen.findByRole('combobox', { name: '按状态过滤' }))
    await user.click(await screen.findByRole('option', { name: '已过期' }))
    await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/v1/plans?') && query(c).get('status') === 'expired')).toBe(true))
  })

  it('按 JSON 新建计划：spec 是这段 JSON 的原文；解析不了时不发请求', async () => {
    const user = userEvent.setup()
    const calls = opsServer({ 'GET /api/v1/plans': page([]), 'POST /api/v1/plan': { body: planView() } })
    renderApp('/changes')
    await user.click(await screen.findByRole('button', { name: '新建计划（JSON）' }))
    const dialog = within(await screen.findByRole('dialog'))
    const box = dialog.getByLabelText('变更（JSON）')
    await user.type(box, '{{')
    await user.click(dialog.getByRole('button', { name: '预演' }))
    expect(await dialog.findByText(/JSON 解析不了/)).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/plan')).toBe(false)
    const text = '[{"op":"update","kind":"Server","id":1,"resourceVersion":3,"spec":{"region":"东京"}}]'
    await user.clear(box)
    await user.click(box)
    await user.paste(text)
    await user.click(dialog.getByRole('button', { name: '预演' }))
    await waitFor(() => expect(calls.find((c) => c.url === '/api/v1/plan')?.body).toEqual({ spec: text }))
    expect(await dialog.findByTestId('plan-review')).toBeTruthy()
  })

  it('按快照回滚：请求带 id；回滚计划列出跳过的对象；按批次回滚时带 apply-id', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/plans': page([]),
      'GET /api/v1/snapshot': page([snapshot(3)]),
      'POST /api/v1/snapshot/rollback': { body: planView({ plan_id: 11, skipped: [{ snapshot_id: 3, kind: 'Server', id: 2, reason: '对象已软删除，不复活' }] }) },
    })
    renderApp('/changes')
    await user.click(await screen.findByRole('tab', { name: '快照' }))
    const row = within(await screen.findByTestId('snapshot-row-3'))
    await user.click(row.getByRole('button', { name: '回滚' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/版本号照常往上加、不会倒退/)).toBeTruthy()
    expect((await dialog.findByTestId('plan-skipped')).textContent).toContain('对象已软删除，不复活')
    const rollbacks = () => calls.filter((c: FakeCall) => c.url === '/api/v1/snapshot/rollback')
    expect(rollbacks()).toHaveLength(1)
    expect(rollbacks()[0]?.body).toEqual({ id: 3 })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(row.getByRole('button', { name: '回滚整批' }))
    await waitFor(() => expect(rollbacks()[1]?.body).toEqual({ 'apply-id': 'ap-1' }))
  })

  it('回滚目标全部被跳过：显示主控的 reason，并列出 state.skipped 里跳过的对象与原因', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/plans': page([]),
      'GET /api/v1/snapshot': page([snapshot(3)]),
      'POST /api/v1/snapshot/rollback': {
        status: 409,
        body: { code: 'conflict', reason: '没有可回滚的对象', state: { skipped: [{ snapshot_id: 3, kind: 'Server', id: 1, reason: '对象已软删除，不复活' }] }, next: '查看 state.skipped 了解跳过原因' },
      },
    })
    renderApp('/changes')
    await user.click(await screen.findByRole('tab', { name: '快照' }))
    await user.click(within(await screen.findByTestId('snapshot-row-3')).getByRole('button', { name: '回滚' }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByText('没有可回滚的对象')).toBeTruthy()
    expect(dialog.getByTestId('plan-skipped').textContent).toContain('Server #1：对象已软删除，不复活')
  })

  it('快照内容：点查看请求 snapshot get 并显示内容', async () => {
    const user = userEvent.setup()
    opsServer({ 'GET /api/v1/plans': page([]), 'GET /api/v1/snapshot': page([snapshot(3)]), 'GET /api/v1/snapshot/get/3': { body: { ...snapshot(3), content: { name: 'hk-1', region: '' } } } })
    renderApp('/changes')
    await user.click(await screen.findByRole('tab', { name: '快照' }))
    await user.click(within(await screen.findByTestId('snapshot-row-3')).getByRole('button', { name: '查看' }))
    expect((await screen.findByTestId('snapshot-content')).textContent).toContain('"name": "hk-1"')
  })

  it('普通用户直接打开 /changes：显示没有权限，不请求计划', async () => {
    const calls = opsServer({}, { ...adminAccount, username: 'bob', role: 'user' })
    renderApp('/changes')
    expect(await screen.findByText('这一页只对管理员开放。')).toBeTruthy()
    expect(calls.some((c) => c.url.startsWith('/api/v1/plans'))).toBe(false)
  })
})
