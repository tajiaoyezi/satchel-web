import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const job = (id: string, status: string, extra: object = {}) => ({
  job_id: id,
  kind: 'backup create',
  args: { args: [], flags: {} },
  status,
  created_at: '2026-10-18T00:00:00Z',
  started_at: '2026-10-18T00:00:01Z',
  finished_at: status === 'done' || status === 'failed' ? '2026-10-18T00:00:09Z' : null,
  exit_code: status === 'failed' ? 1 : status === 'done' ? 0 : null,
  output: null,
  output_truncated: false,
  ...extra,
})

// web-console「长任务页」的组件部分。
describe('长任务页', () => {
  it('看失败的 job：点开后显示 output 里的 reason 与 next', async () => {
    const user = userEvent.setup()
    const failed = job('job-f', 'failed', { output: JSON.stringify({ code: 'unavailable', reason: 'pg_dump 不可用', state: {}, next: '装上 postgresql-client' }), output_truncated: true })
    opsServer({ 'GET /api/v1/job': page([failed]), 'GET /api/v1/job/get/job-f': { body: failed } })
    renderApp('/jobs')
    await user.click(await screen.findByRole('button', { name: 'job-f' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('pg_dump 不可用')).toBeTruthy()
    expect(within(dialog).getByText('下一步：装上 postgresql-client')).toBeTruthy()
    expect(within(dialog).getByText(/已截断/)).toBeTruthy()
    expect(within(dialog).getByTestId('job-output').textContent).toContain('"code": "unavailable"')
  })

  it('运行中的 job 自动刷新：主控上变成 done 之后，几秒内页面上也是完成', async () => {
    let n = 0
    const calls = opsServer({ 'GET /api/v1/job': () => page([job('job-r', n++ === 0 ? 'running' : 'done')]) })
    renderApp('/jobs')
    const row = await screen.findByTestId('job-job-r')
    expect(within(row).getByText('运行中')).toBeTruthy()
    expect(await within(screen.getByTestId('job-job-r')).findByText('完成', {}, { timeout: 4000 })).toBeTruthy()
    const lists = calls.filter((c) => c.url.startsWith('/api/v1/job?')).length
    await new Promise((r) => setTimeout(r, 2500))
    expect(calls.filter((c) => c.url.startsWith('/api/v1/job?')).length).toBe(lists) // 没有运行中的了，不再刷新
  }, 10000)
})
