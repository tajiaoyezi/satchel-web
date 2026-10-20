import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

// 迁移完成之后要等主控重启：测试里不走到这一步之外，换成一直不返回的假函数。
vi.mock('@/lib/restart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/restart')>()),
  waitForRestart: vi.fn(() => new Promise<void>(() => {})),
}))

afterEach(() => vi.unstubAllGlobals())

const sqlite = { driver: 'sqlite', path: '/var/lib/satchel/satchel.db', size: 2 * 1024 * 1024, password_configured: false, env_override: false }

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('主机'), 'db.example')
  await user.type(screen.getByLabelText('库名'), 'satchel')
  await user.type(screen.getByLabelText('用户'), 'satchel')
  await user.type(screen.getByLabelText('密码'), 'pgpass')
}

// web-console「数据库页」的组件部分。
describe('数据库页', () => {
  it('试连一个不为空的库：显示目标不为空并列出已有的表', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/database/show': { body: sqlite },
      'POST /api/v1/database/test': { body: { server_version: '16.4', empty: false, tables: ['t'], backup_tools: { ok: true } } },
    })
    renderApp('/database')
    expect(await screen.findByText('/var/lib/satchel/satchel.db')).toBeTruthy()
    await fill(user)
    await user.click(screen.getByRole('button', { name: '试连' }))
    const result = await screen.findByTestId('database-test-result')
    expect(result).toHaveTextContent('目标库不是空的')
    expect(result).toHaveTextContent('t')
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/database/test')?.body).toEqual({ host: 'db.example', port: 5432, name: 'satchel', user: 'satchel', password: 'pgpass', sslmode: 'prefer' })
  })

  it('迁移时显示进度：先确认再当场验证，请求带连接参数与 verify-password；随后显示正在拷贝与 3/20', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/database/show': { body: sqlite },
      'POST /api/v1/database/migrate': { body: { job_id: 'job-m', kind: 'database migrate', status: 'queued', created_at: '2026-10-18T00:00:00Z', output: null, output_truncated: false } },
      'GET /api/v1/job/get/job-m': {
        body: { job_id: 'job-m', kind: 'database migrate', status: 'running', created_at: '2026-10-18T00:00:00Z', output: null, output_truncated: false, progress: { phase: 'copying', table: 'users', tables_done: 3, tables_total: 20, rows: 120 } },
      },
    })
    renderApp('/database')
    await fill(user)
    await user.click(screen.getByRole('button', { name: '迁移' }))
    expect(await screen.findByText(/拷贝期间除了查看进度，别的操作都会被拒/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '迁移' }))
    await user.type(await screen.findByLabelText('密码', { selector: '#verify-password' }), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText('阶段：正在拷贝', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('表：3/20')).toBeTruthy()
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/database/migrate')?.body).toEqual({
      host: 'db.example',
      port: 5432,
      name: 'satchel',
      user: 'satchel',
      password: 'pgpass',
      sslmode: 'prefer',
      'verify-password': 'secret12',
    })
    expect(screen.getByRole('button', { name: '迁移' })).toBeDisabled()
  })

  it('已经是 PostgreSQL：迁移按钮不可用，并说明原因', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/database/show': { body: { driver: 'postgres', host: 'db', port: 5432, name: 'satchel', user: 'satchel', sslmode: 'require', password_configured: true, env_override: false } },
    })
    renderApp('/database')
    expect(await screen.findByText('已经在用 PostgreSQL，只支持从 SQLite 迁移到 PostgreSQL。')).toBeTruthy()
    await user.type(screen.getByLabelText('主机'), 'x')
    expect(screen.getByRole('button', { name: '迁移' })).toBeDisabled()
    expect(screen.getByTestId('database-current')).toHaveTextContent('已配置')
  })

  it('迁移完成后等主控重启', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/database/show': { body: sqlite },
      'POST /api/v1/database/migrate': { body: { job_id: 'job-m', kind: 'database migrate', status: 'queued', created_at: '2026-10-18T00:00:00Z', output: null, output_truncated: false } },
      'GET /api/v1/job/get/job-m': { body: { job_id: 'job-m', kind: 'database migrate', status: 'done', created_at: '2026-10-18T00:00:00Z', output: '{"tables":20,"rows":1234}', output_truncated: false } },
    })
    renderApp('/database')
    await fill(user)
    await user.click(screen.getByRole('button', { name: '迁移' }))
    await user.click(await screen.findByRole('button', { name: '迁移' }))
    await user.type(await screen.findByLabelText('密码', { selector: '#verify-password' }), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText('迁移完成：拷了 20 张表、1234 行。', {}, { timeout: 3000 })).toBeTruthy()
    await waitFor(() => expect(screen.getByText('主控正在重启并改用 PostgreSQL…')).toBeTruthy())
  })
})
