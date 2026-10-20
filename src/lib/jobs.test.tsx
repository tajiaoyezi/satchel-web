import '@/i18n'

import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Job } from '@/api/types'
import { JobProgress } from '@/components/JobProgress'

import { useJobFollower } from './jobs'

const accepted: Job = {
  job_id: 'job-1',
  kind: 'backup create',
  status: 'queued',
  created_at: '2026-10-18T00:00:00Z',
  started_at: null,
  finished_at: null,
  exit_code: null,
  output: null,
  output_truncated: false,
}

// 假时钟：sleep 只推进时间，不真等。
function clock() {
  let t = 0
  return { sleep: async (ms: number) => void (t += ms), now: () => t }
}

// replies 让 fetch 依次给出这些回应：'down' 是网络错误，'hang' 是一直不回（直到 signal 中止），对象是 job get 的回应；
// 用完之后一直给最后一个。
function replies(seq: (Partial<Job> | 'down' | 'hang')[]) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url)
      const r = seq[Math.min(urls.length - 1, seq.length - 1)]
      if (r === 'down') throw new TypeError('Failed to fetch')
      if (r === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error)))
      return new Response(JSON.stringify({ ...accepted, ...r }), { status: 200 })
    }),
  )
  return urls
}

afterEach(() => vi.unstubAllGlobals())

// web-console「长任务的跟踪」。
describe('useJobFollower', () => {
  it('跟到结束：每秒查一次 job get，done 时停下并调 onFinish', async () => {
    const c = clock()
    const urls = replies([{ status: 'running' }, { status: 'done', output: '{"name":"satchel-backup-1.zip"}' }])
    const onFinish = vi.fn()
    const { result } = renderHook(() => useJobFollower(accepted, { ...c, onFinish }))
    expect(result.current.job.status).toBe('queued')
    await waitFor(() => expect(result.current.job.status).toBe('done'))
    expect(urls).toEqual(['/api/v1/job/get/job-1', '/api/v1/job/get/job-1'])
    expect(c.now()).toBe(2000)
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(onFinish.mock.calls[0][0].status).toBe('done')
  })

  it('主控重启期间接着查：连续 5 秒连不上之后 done，不算失败', async () => {
    const c = clock()
    const urls = replies(['down', 'down', 'down', 'down', 'down', { status: 'done', output: '{}' }])
    const { result } = renderHook(() => useJobFollower(accepted, c))
    await waitFor(() => expect(result.current.job.status).toBe('done'))
    expect(result.current.unreachable).toBe(false)
    expect(result.current.error).toBeNull()
    expect(urls).toHaveLength(6)
  })

  it('连不上太久：从第一次连不上起满 2 分钟就停止查询', async () => {
    const c = clock()
    const urls = replies([{ status: 'running' }, 'down'])
    const { result } = renderHook(() => useJobFollower(accepted, c))
    await waitFor(() => expect(result.current.unreachable).toBe(true))
    expect(result.current.job.status).toBe('running')
    const n = urls.length
    expect(c.now() - 2000).toBeGreaterThanOrEqual(120000) // 第 2 秒第一次连不上
    await new Promise((r) => setTimeout(r, 20))
    expect(urls).toHaveLength(n)
  })

  it('请求一直不回：每次超时中止、算连不上，从第一次发出起满上限就停', async () => {
    const c = clock()
    const urls = replies(['hang'])
    const { result } = renderHook(() => useJobFollower(accepted, { ...c, maxDownMs: 5000, timeoutMs: 20 }))
    await waitFor(() => expect(result.current.unreachable).toBe(true))
    expect(result.current.error).toBeNull()
    expect(c.now()).toBe(6000) // 第 1 秒发出第一次，到第 6 秒满 5 秒
    expect(urls).toHaveLength(6)
  })

  it('主控的四字段错误不算连不上：停下并给出错误', async () => {
    const c = clock()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'not_found', reason: '没有这个 job', state: {}, next: '' }), { status: 404 })))
    const { result } = renderHook(() => useJobFollower(accepted, c))
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.unreachable).toBe(false)
  })

  it('卸载之后不再查', async () => {
    const urls = replies([{ status: 'running' }])
    let release = () => {}
    const sleep = () => new Promise<void>((r) => (release = r))
    const { unmount } = renderHook(() => useJobFollower(accepted, { sleep }))
    unmount()
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(urls).toHaveLength(0)
  })
})

describe('JobProgress', () => {
  it('失败的 job：显示 output 里四字段错误的 reason 与 next', async () => {
    replies([{ status: 'failed', output: JSON.stringify({ code: 'unavailable', reason: 'pg_dump 不可用', state: {}, next: '装上 postgresql-client' }) }])
    render(<JobProgress accepted={accepted} />)
    expect(await screen.findByText('pg_dump 不可用', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('下一步：装上 postgresql-client')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
  })

  it('进行中显示认得的进度字段，认不出的按 JSON', async () => {
    replies([{ status: 'running', progress: { phase: 'copying', tables_done: 3, tables_total: 20, table: 'users', extra: 1 } }])
    render(<JobProgress accepted={accepted} />)
    expect(await screen.findByText('阶段：正在拷贝', {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByText('表：3/20')).toBeTruthy()
    expect(screen.getByText('当前表：users')).toBeTruthy()
    expect(screen.getByTestId('job-progress-fields').textContent).toContain('"extra": 1')
  })
})
