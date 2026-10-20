import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Job } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { formatBytes } from '@/lib/format'
import { jobError, jobFinished, jobOutput, useJobFollower } from '@/lib/jobs'

// JobProgress 跟一个受理了的长任务并显示它（web-console「长任务的跟踪」）：状态、进行时已知的 progress 字段、结局。done 时用
// renderDone 显示 output；failed 时显示 output 里的四字段错误；连不上太久时说明 job 仍在主控里。换 job 时用 key 换一个新的组件。
export function JobProgress({ accepted, onFinish, renderDone }: { accepted: Job; onFinish?: (job: Job) => void; renderDone?: (output: unknown) => ReactNode }) {
  const { t } = useTranslation()
  const { job, unreachable, error } = useJobFollower(accepted, { onFinish })
  return (
    <div className="grid gap-2 text-sm" data-testid="job-progress">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{job.job_id}</span>
        <JobStatus status={job.status} />
      </p>
      {!jobFinished(job) && job.progress && <ProgressFields progress={job.progress} />}
      {job.status === 'done' && renderDone?.(jobOutput(job))}
      {job.status === 'failed' && <ErrorNotice error={jobError(job) ?? new Error(t('job.failed'))} />}
      {unreachable && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{t('job.unreachable', { id: job.job_id })}</AlertDescription>
        </Alert>
      )}
      <ErrorNotice error={error} />
    </div>
  )
}

export function JobStatus({ status }: { status: string }) {
  const { t } = useTranslation()
  const variant = status === 'failed' ? 'destructive' : status === 'done' ? 'default' : 'outline'
  return <Badge variant={variant}>{t(`job.statuses.${status}` as 'job.statuses.done', { defaultValue: status })}</Badge>
}

// KNOWN 是认得的进度字段：数据库迁移的 phase、table、tables_done、tables_total、rows，升级的 phase、source、bytes、total。
const KNOWN = new Set(['phase', 'table', 'tables_done', 'tables_total', 'rows', 'source', 'bytes', 'total'])

// ProgressFields 把认得的进度字段写成几行字，认不出的字段按 JSON 显示。
export function ProgressFields({ progress: p }: { progress: Record<string, unknown> }) {
  const { t } = useTranslation()
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  const lines: string[] = []
  if (typeof p.phase === 'string') lines.push(t('job.phase', { phase: t(`job.phases.${p.phase}` as 'job.phases.copying', { defaultValue: p.phase }) }))
  if (num(p.tables_total) > 0) lines.push(t('job.tables', { done: num(p.tables_done), total: num(p.tables_total) }))
  if (typeof p.table === 'string' && p.table) lines.push(t('job.table', { table: p.table }))
  if (num(p.rows) > 0) lines.push(t('job.rows', { rows: num(p.rows) }))
  if (typeof p.source === 'string' && p.source) lines.push(t('job.source', { source: p.source }))
  if (num(p.bytes) > 0) lines.push(num(p.total) > 0 ? t('job.bytesOf', { bytes: formatBytes(num(p.bytes)), total: formatBytes(num(p.total)) }) : t('job.bytes', { bytes: formatBytes(num(p.bytes)) }))
  const rest = Object.fromEntries(Object.entries(p).filter(([k]) => !KNOWN.has(k)))
  return (
    <div className="grid gap-0.5" data-testid="job-progress-fields">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
      {Object.keys(rest).length > 0 && <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">{JSON.stringify(rest, null, 2)}</pre>}
    </div>
  )
}
