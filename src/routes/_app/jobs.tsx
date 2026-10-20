import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Job, Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobStatus, ProgressFields } from '@/components/JobProgress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'
import { jobError, jobOutput } from '@/lib/jobs'

export const Route = createFileRoute('/_app/jobs')({ component: JobsPage })

const STATUSES = ['all', 'queued', 'running', 'done', 'failed', 'unknown'] as const

const running = (j: Job) => j.status === 'queued' || j.status === 'running'

// 长任务页（web-console「长任务页」）：按 id 倒序列出 job，可按状态过滤；有排队或运行中的 job 时每 2 秒刷新；点开看 job get 的全部字段。
function JobsPage() {
  const { t } = useTranslation('jobs')
  return (
    <AdminPage title={t('title')}>
      <JobsBody />
    </AdminPage>
  )
}

function JobsBody() {
  const { t } = useTranslation('jobs')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [open, setOpen] = useState<string | null>(null)
  const list = useInfiniteQuery({
    queryKey: ['job list', status],
    queryFn: ({ pageParam }) => run<Page<Job>>('job list', { flags: { status: status === 'all' ? undefined : status }, limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some(running)) ? 2000 : false),
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('description')}</CardDescription>
        <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUSES)[number])}>
          <SelectTrigger aria-label={t('statusFilter')} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'all' ? t('allStatuses') : t(`job.statuses.${s}`, { ns: 'common' })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.id')}</TableHead>
              <TableHead>{t('columns.kind')}</TableHead>
              <TableHead>{t('columns.status')}</TableHead>
              <TableHead>{t('columns.createdAt')}</TableHead>
              <TableHead>{t('columns.startedAt')}</TableHead>
              <TableHead>{t('columns.finishedAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((j) => (
              <TableRow key={j.job_id} data-testid={`job-${j.job_id}`}>
                <TableCell>
                  <Button variant="link" size="sm" className="px-0 font-mono" onClick={() => setOpen(j.job_id)}>
                    {j.job_id}
                  </Button>
                </TableCell>
                <TableCell>{j.kind}</TableCell>
                <TableCell>
                  <JobStatus status={j.status} />
                </TableCell>
                <TableCell>{formatTime(j.created_at)}</TableCell>
                <TableCell>{formatTime(j.started_at)}</TableCell>
                <TableCell>{formatTime(j.finished_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
      {open && <JobDetail id={open} onClose={() => setOpen(null)} />}
    </Card>
  )
}

// JobDetail 是一个 job 的 job get：全部字段，output 按 JSON 格式化；failed 时另外显示四字段错误。
function JobDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation('jobs')
  const got = useQuery({ queryKey: ['job get', id], queryFn: () => run<Job>('job get', { args: [id] }) })
  const job = got.data
  const output = job ? jobOutput(job) : null
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('detail.title', { id })}</DialogTitle>
          <DialogDescription>{job?.kind}</DialogDescription>
        </DialogHeader>
        <ErrorNotice error={got.error} />
        {job && (
          <div className="grid gap-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">{t('columns.status')}</dt>
              <dd>
                <JobStatus status={job.status} />
              </dd>
              <dt className="text-muted-foreground">{t('columns.createdAt')}</dt>
              <dd>{formatTime(job.created_at)}</dd>
              <dt className="text-muted-foreground">{t('columns.startedAt')}</dt>
              <dd>{formatTime(job.started_at)}</dd>
              <dt className="text-muted-foreground">{t('columns.finishedAt')}</dt>
              <dd>{formatTime(job.finished_at)}</dd>
              <dt className="text-muted-foreground">{t('detail.exitCode')}</dt>
              <dd>{job.exit_code ?? ''}</dd>
            </dl>
            {job.args !== undefined && job.args !== null && (
              <div className="grid gap-1">
                <h3 className="font-medium">{t('detail.args')}</h3>
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">{JSON.stringify(job.args, null, 2)}</pre>
              </div>
            )}
            {running(job) && job.progress && (
              <div className="grid gap-1">
                <h3 className="font-medium">{t('detail.progress')}</h3>
                <ProgressFields progress={job.progress} />
              </div>
            )}
            {job.status === 'failed' && <ErrorNotice error={jobError(job)} />}
            <div className="grid gap-1">
              <h3 className="font-medium">{t('detail.output')}</h3>
              {job.output_truncated && <p className="text-muted-foreground">{t('detail.truncated')}</p>}
              {output === null ? (
                <p className="text-muted-foreground">{t('detail.noOutput')}</p>
              ) : (
                <pre className="bg-muted overflow-x-auto rounded p-2 text-xs" data-testid="job-output">
                  {typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
