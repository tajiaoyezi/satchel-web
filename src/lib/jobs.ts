import { useEffect, useEffectEvent, useState } from 'react'

import { ApiError, isUnreachable, run, type ErrorBody } from '@/api/client'
import type { Job } from '@/api/types'

// FINISHED 是 job 的结局：done、failed，以及留给 M2 的 unknown（CLI 也把它当作结束）。
const FINISHED = new Set(['done', 'failed', 'unknown'])

export function jobFinished(job: Job): boolean {
  return FINISHED.has(job.status)
}

// jobOutput 把 output 的 JSON 文本解开；解不开（如被截断）时给原文。
export function jobOutput(job: Job): unknown {
  if (job.output === null) return null
  try {
    return JSON.parse(job.output) as unknown
  } catch {
    return job.output
  }
}

// jobError 是 failed 的 job 的 output 里的四字段错误；不是四字段错误时为 null。
export function jobError(job: Job): ApiError | null {
  if (job.status !== 'failed') return null
  const out = jobOutput(job) as Partial<ErrorBody> | null
  if (!out || typeof out !== 'object' || typeof out.code !== 'string') return null
  return new ApiError(0, { code: out.code, reason: out.reason ?? '', state: out.state ?? {}, next: out.next ?? '' })
}

export interface FollowState {
  job: Job
  unreachable: boolean // 连不上主控超过上限，已经停止查询
  error: unknown // 查询本身失败了（不是连不上），已经停止查询
}

export interface FollowOptions {
  onFinish?: (job: Job) => void
  intervalMs?: number
  maxDownMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// useJobFollower 跟一个受理了的长任务（web-console「长任务的跟踪」）：每隔 intervalMs 查一次 job get，直到结局，结局时调 onFinish。
// 连不上主控（isUnreachable）不算失败：接着查，从第一次连不上的那次请求发出时起满 maxDownMs 才停；中间有一次成功就重新算。
// 一次请求过了 timeoutMs 还没回应就中止，算连不上：挂住不回的请求不会让上限失效。组件卸载时停止查询，job 不受影响。
// sleep 与 now 可以换，测试里不用真等。
export function useJobFollower(
  accepted: Job,
  { onFinish, intervalMs = 1000, maxDownMs = 120000, timeoutMs = 10000, sleep = realSleep, now = Date.now }: FollowOptions = {},
): FollowState {
  const [state, setState] = useState<FollowState>({ job: accepted, unreachable: false, error: null })
  const finish = useEffectEvent((job: Job) => onFinish?.(job))
  const jobId = accepted.job_id
  useEffect(() => {
    let stopped = false
    void (async () => {
      let downSince: number | null = null
      for (;;) {
        await sleep(intervalMs)
        if (stopped) return
        const started = now()
        let job: Job
        try {
          job = await run<Job>('job get', { args: [jobId], signal: AbortSignal.timeout(timeoutMs) })
        } catch (e) {
          if (stopped) return
          if (!isUnreachable(e)) return setState((s) => ({ ...s, error: e }))
          downSince ??= started
          if (now() - downSince >= maxDownMs) return setState((s) => ({ ...s, unreachable: true }))
          continue
        }
        if (stopped) return
        downSince = null
        setState({ job, unreachable: false, error: null })
        if (jobFinished(job)) return finish(job)
      }
    })()
    return () => {
      stopped = true
    }
  }, [jobId, intervalMs, maxDownMs, timeoutMs, sleep, now])
  return state
}
