import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const tasks = [
  { name: 'audit_cleanup', summary: '清理过期的审计记录', interval: '24h0m0s', last_started_at: '2026-10-18T00:00:00Z', last_status: 'ok' },
  { name: 'backup_local', summary: '每天生成一份本机备份', interval: '1h0m0s', last_started_at: null, last_status: '' },
]
const runs = [
  { id: 2, task: 'backup_local', started_at: '2026-10-18T01:00:00Z', duration_ms: 1200, status: 'error', detail: 'disk full' },
  { id: 1, task: 'audit_cleanup', started_at: '2026-10-18T00:00:00Z', duration_ms: 15, status: 'ok', detail: 'deleted 0' },
]

// web-console「定时任务页」的组件部分。
describe('定时任务页', () => {
  it('看一个任务的运行记录：点任务名后请求带 task，只显示它的记录；再点一次取消', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/schedule': page(tasks),
      'GET /api/v1/schedule/runs': (c) => page(runs.filter((r) => !query(c).get('task') || r.task === query(c).get('task'))),
    })
    renderApp('/schedule')
    expect(await screen.findByText('还没有运行记录')).toBeTruthy()
    expect(await screen.findByTestId('run-2')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'audit_cleanup' }))
    await waitFor(() => expect(screen.queryByTestId('run-2')).toBeNull())
    expect(screen.getByTestId('run-1')).toBeTruthy()
    expect(query(calls.filter((c) => c.url.startsWith('/api/v1/schedule/runs')).at(-1)!).get('task')).toBe('audit_cleanup')
    await user.click(screen.getByRole('button', { name: 'audit_cleanup' }))
    expect(await screen.findByTestId('run-2')).toBeTruthy()
  })

  it('按状态过滤：请求带 status', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/schedule': page(tasks),
      'GET /api/v1/schedule/runs': (c) => page(runs.filter((r) => !query(c).get('status') || r.status === query(c).get('status'))),
    })
    renderApp('/schedule')
    await screen.findByTestId('run-1')
    await user.click(screen.getByRole('combobox', { name: '状态' }))
    await user.click(await screen.findByRole('option', { name: '出错' }))
    await waitFor(() => expect(screen.queryByTestId('run-1')).toBeNull())
    expect(query(calls.at(-1)!).get('status')).toBe('error')
  })
})
