import '@/i18n'

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/api/query'
import { DialogsProvider } from '@/components/dialogs/DialogsProvider'
import { fakeServer, type FakeCall, type FakeReply } from '@/test/server'

import { PlanReview, type ApplyResult, type PlanView } from './-plan'

afterEach(() => vi.unstubAllGlobals())

export const planView = (patch: Partial<PlanView> = {}): PlanView => ({
  plan_id: 7,
  status: 'pending',
  affected_count: 1,
  expires_at: '2026-11-22T10:10:00Z',
  created_at: '2026-11-22T10:00:00Z',
  required_dangers: [],
  objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', field_diff: { region: { before: '', after: '东京' }, sort_order: { before: 0, after: 5 } } }],
  servers: [
    {
      server_id: 1,
      server_name: 'hk-1',
      expected_current_hash: 'aaaaaaaaaaaaaaaa',
      next_hash: 'bbbbbbbbbbbbbbbb',
      config_changed: true,
      first_apply_eligible: false,
      inbounds: ['in1'],
      before_config: '{\n  "log": {"level": "warn"},\n  "inbounds": []\n}',
      after_config: '{\n  "log": {"level": "info"},\n  "inbounds": []\n}',
    },
  ],
  ...patch,
})

const applied: ApplyResult = {
  plan_id: 7,
  apply_id: 'ap-1',
  affected_count: 1,
  objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', resourceVersion: 4 }],
  servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'bbbbbbbbbbbbbbbb' }],
}

function renderPlan(plan: PlanView, routes: Record<string, FakeReply | ((c: FakeCall) => FakeReply)>, onApplied = vi.fn()) {
  const calls = fakeServer(routes)
  render(
    <QueryClientProvider client={createQueryClient(() => {})}>
      <DialogsProvider>
        <PlanReview plan={plan} onApplied={onApplied} />
      </DialogsProvider>
    </QueryClientProvider>,
  )
  return { calls, onApplied, user: userEvent.setup() }
}

const applyCalls = (calls: FakeCall[]) => calls.filter((c) => c.method === 'POST' && c.url === '/api/v1/apply')

// web-console「配置的预演与提交」（m2-16）。
describe('配置的预演与提交', () => {
  it('显示计划信息与每个字段的前后值', () => {
    renderPlan(planView(), {})
    const region = within(screen.getByTestId('plan-field-region'))
    expect(region.getByText('（空）')).toBeTruthy()
    expect(region.getByText('东京')).toBeTruthy()
    expect(within(screen.getByTestId('plan-field-sort_order')).getByText('5')).toBeTruthy()
    expect(screen.getByTestId('plan-dangers').textContent).toBe('无')
    expect(screen.getByText('待提交')).toBeTruthy()
  })

  it('需要危险类时确认值是 confirm_hint：取消不发请求；确认后请求带 plan 与 confirm', async () => {
    const { calls, user, onApplied } = renderPlan(planView({ required_dangers: ['permission'], confirm_hint: 'hk-1' }), { 'POST /api/v1/apply': { body: applied } })
    expect(screen.getByTestId('plan-dangers').textContent).toBe('权限类')
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('要确认的值：hk-1')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByText('要确认的值：hk-1')).toBeNull())
    expect(applyCalls(calls)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '提交' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    await waitFor(() => expect(applyCalls(calls)[0]?.body).toEqual({ plan: 7, confirm: 'hk-1' }))
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied))
  })

  it('不需要危险类时直接提交：请求体只有 plan；成功后逐台显示节点结果，不再有提交按钮', async () => {
    const { calls, user } = renderPlan(planView(), { 'POST /api/v1/apply': { body: applied } })
    await user.click(screen.getByRole('button', { name: '提交' }))
    await waitFor(() => expect(applyCalls(calls)[0]?.body).toEqual({ plan: 7 }))
    const row = within(await screen.findByTestId('apply-server-hk-1'))
    expect(row.getByText('已生效')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull()
  })

  it('部分节点失败：写明配置已写入主控库，逐台列出失败原因与回滚；主控库已写入，也通知调用方', async () => {
    const { user, onApplied } = renderPlan(planView(), {
      'POST /api/v1/apply': {
        status: 409,
        body: {
          code: 'partial_failure',
          reason: '配置已写入主控库（apply_id=ap-1），但 1/1 台节点未成功落地',
          state: {
            apply_id: 'ap-1',
            objects: [{ op: 'update', kind: 'Server', id: 1, name: 'hk-1', resourceVersion: 4 }],
            results: [{ server_id: 1, server_name: 'hk-1', status: 'failed', error: '服务器 "hk-1" 现在没有连接', rolled_back: true }],
          },
          next: '',
        },
      },
    })
    await user.click(screen.getByRole('button', { name: '提交' }))
    const partial = within(await screen.findByTestId('apply-partial'))
    expect(partial.getByText('配置已写入主控库，但有节点没有落地')).toBeTruthy()
    const row = within(partial.getByTestId('apply-server-hk-1'))
    expect(row.getByText('失败')).toBeTruthy()
    expect(row.getByText('服务器 "hk-1" 现在没有连接')).toBeTruthy()
    expect(row.getByText('节点已回滚到旧配置。')).toBeTruthy()
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ apply_id: 'ap-1', objects: [expect.objectContaining({ id: 1, resourceVersion: 4 })] })))
    // 主控库已经写入，这份计划已经提交过：不再显示「提交」，部分失败的说明一直留着
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull()
  })

  it('版本冲突：原样显示 reason，并提示重新预演', async () => {
    const { user } = renderPlan(planView(), {
      'POST /api/v1/apply': { status: 409, body: { code: 'version_conflict', reason: 'Server 期望版本是 3，当前版本是 4', state: {}, next: '' } },
    })
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('Server 期望版本是 3，当前版本是 4')).toBeTruthy()
    expect(screen.getByText(/重新预演/)).toBeTruthy()
  })

  it('查看 kernel.json 的前后对比：点了才显示，按行标出增删', async () => {
    const { user } = renderPlan(planView(), {})
    expect(screen.queryByTestId('config-diff')).toBeNull()
    await user.click(screen.getByRole('button', { name: '查看 kernel.json 对比' }))
    const diff = screen.getByTestId('config-diff')
    expect(diff.querySelectorAll('[data-diff="del"]')).toHaveLength(1)
    expect(diff.querySelectorAll('[data-diff="add"]')).toHaveLength(1)
    expect(diff.querySelector('[data-diff="add"]')?.textContent).toContain('"info"')
  })

  it('不是 pending 的计划不显示提交；回滚计划列出跳过的对象', () => {
    renderPlan(planView({ status: 'applied', skipped: [{ snapshot_id: 3, kind: 'Server', id: 2, reason: '对象已软删除，不复活' }] }), {})
    expect(screen.queryByRole('button', { name: '提交' })).toBeNull()
    expect(screen.getByTestId('plan-skipped').textContent).toContain('Server #2：对象已软删除，不复活')
  })
})

// m2-22：改动主控同机服务器的网站或 nginx 的计划要当场验证；预演结果显示 nginx 站点配置，提交结果写明写入与重载。
describe('配置的预演与提交：同机服务器与网站配置', () => {
  const verifyAs = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
  }

  it('带 requires_human：写明要当场验证；取消验证不发请求；验证后请求带 plan 与 verify-password', async () => {
    const { calls, user } = renderPlan(planView({ requires_human: true }), { 'POST /api/v1/apply': { body: applied } })
    expect(screen.getByTestId('plan-requires-human').textContent).toContain('提交时要当场验证')
    await user.click(screen.getByRole('button', { name: '提交' }))
    const dialog = within(await screen.findByRole('dialog', { name: '当场验证' }))
    await user.click(dialog.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull())
    expect(applyCalls(calls)).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '提交' }))
    await verifyAs(user)
    await waitFor(() => expect(applyCalls(calls)[0]?.body).toEqual({ plan: 7, 'verify-password': 'secret12' }))
  })

  it('既要危险类又要当场验证：先危险确认，再验证；请求带 confirm 与 verify-password', async () => {
    const { calls, user } = renderPlan(planView({ requires_human: true, required_dangers: ['delete'], confirm_hint: '1' }), { 'POST /api/v1/apply': { body: applied } })
    await user.click(screen.getByRole('button', { name: '提交' }))
    expect(await screen.findByText('要确认的值：1')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: '当场验证' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await verifyAs(user)
    await waitFor(() => expect(applyCalls(calls)[0]?.body).toEqual({ plan: 7, confirm: '1', 'verify-password': 'secret12' }))
  })

  it('预演结果里的网站配置：写明写入的站点与配置文件，点了才展开配置内容；提交结果写明写入的站点与 nginx 重载', async () => {
    const base = planView().servers![0]!
    const plan = planView({
      servers: [
        {
          ...base,
          websites: [{ domain: 'app.example.com', action: 'apply', conf_path: '/etc/nginx/servers/app.example.com.conf', conf: '# satchel-managed: website\nserver {}' }],
          steal_config: { domain: '', action: 'remove', conf_path: '/etc/nginx/servers/satchel-steal.conf' },
        },
      ],
    })
    const done: ApplyResult = { ...applied, servers: [{ server_id: 1, server_name: 'hk-1', status: 'applied', applied_hash: 'cc', websites_applied: ['app.example.com'], nginx_reloaded: true }] }
    const { user } = renderPlan(plan, { 'POST /api/v1/apply': { body: done } })
    const site = within(screen.getByTestId('plan-site-app.example.com'))
    expect(site.getByText('写入')).toBeTruthy()
    expect(site.getByText('/etc/nginx/servers/app.example.com.conf')).toBeTruthy()
    expect(screen.queryByText(/server \{\}/)).toBeNull()
    await user.click(site.getByRole('button', { name: '查看配置' }))
    expect(screen.getByText(/# satchel-managed: website/)).toBeTruthy()
    const steal = within(screen.getByTestId('plan-site-steal'))
    expect(steal.getByText('移除')).toBeTruthy()
    expect(steal.getByText('偷自己的 nginx 配置')).toBeTruthy()
    expect(steal.queryByRole('button', { name: '查看配置' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '提交' }))
    const nginx = await screen.findByTestId('apply-nginx-hk-1')
    expect(nginx.textContent).toContain('写入站点：app.example.com')
    expect(nginx.textContent).toContain('nginx 已重载')
  })
})
