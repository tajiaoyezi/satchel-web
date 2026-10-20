import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/schedule')({ component: SchedulePage })

interface TaskInfo {
  name: string
  summary: string
  interval: string
  last_started_at: string | null
  last_status: string
}

interface TaskRun {
  id: number
  task: string
  started_at: string
  duration_ms: number
  status: string
  detail: string
}

const STATUSES = ['all', 'running', 'ok', 'error'] as const

// 定时任务页（web-console「定时任务页」）：上面是内置任务，下面是运行记录；点任务名按它过滤运行记录。
function SchedulePage() {
  const { t } = useTranslation('schedule')
  return (
    <AdminPage title={t('title')}>
      <ScheduleBody />
    </AdminPage>
  )
}

function ScheduleBody() {
  const { t } = useTranslation('schedule')
  const [task, setTask] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const tasks = useQuery({ queryKey: ['schedule list'], queryFn: () => run<Page<TaskInfo>>('schedule list', { limit: 100 }) })
  const runs = useInfiniteQuery({
    queryKey: ['schedule runs list', task, status],
    queryFn: ({ pageParam }) => run<Page<TaskRun>>('schedule runs list', { flags: { task: task || undefined, status: status === 'all' ? undefined : status }, limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = runs.data?.pages.flatMap((p) => p.items) ?? []
  const statusLabel = (s: string) => t(`statuses.${s}` as 'statuses.ok', { defaultValue: s })
  return (
    <>
      <Card className="shadow-flat">
        <CardHeader>
          <CardTitle>{t('tasks.title')}</CardTitle>
          <CardDescription>{t('tasks.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ErrorNotice error={tasks.error} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('tasks.name')}</TableHead>
                <TableHead>{t('tasks.summary')}</TableHead>
                <TableHead>{t('tasks.interval')}</TableHead>
                <TableHead>{t('tasks.last')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.data?.items.map((x) => (
                <TableRow key={x.name}>
                  <TableCell>
                    <Button variant={task === x.name ? 'secondary' : 'link'} size="sm" className="px-1 font-mono" aria-pressed={task === x.name} onClick={() => setTask(task === x.name ? '' : x.name)}>
                      {x.name}
                    </Button>
                  </TableCell>
                  <TableCell>{x.summary}</TableCell>
                  <TableCell>{x.interval}</TableCell>
                  <TableCell>
                    {x.last_started_at ? (
                      <span className="flex flex-wrap items-center gap-2">
                        {formatTime(x.last_started_at)}
                        <Badge variant={x.last_status === 'error' ? 'destructive' : 'outline'}>{statusLabel(x.last_status)}</Badge>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('tasks.never')}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card className="shadow-flat">
        <CardHeader className="grid gap-3">
          <CardTitle>{t('runs.title')}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as (typeof STATUSES)[number])}>
              <SelectTrigger aria-label={t('runs.status')} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === 'all' ? t('runs.allStatuses') : statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {task && (
              <Badge variant="secondary" className="gap-1">
                {t('runs.taskFilter', { task })}
                <button type="button" aria-label={t('runs.clearTask')} onClick={() => setTask('')}>
                  <X className="size-3" />
                </button>
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ErrorNotice error={runs.error} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('runs.task')}</TableHead>
                <TableHead>{t('runs.startedAt')}</TableHead>
                <TableHead>{t('runs.duration')}</TableHead>
                <TableHead>{t('runs.status')}</TableHead>
                <TableHead>{t('runs.detail')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && !runs.isPending && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {t('runs.empty')}
                  </TableCell>
                </TableRow>
              )}
              {items.map((r) => (
                <TableRow key={r.id} data-testid={`run-${r.id}`}>
                  <TableCell className="font-mono">{r.task}</TableCell>
                  <TableCell>{formatTime(r.started_at)}</TableCell>
                  <TableCell>{t('runs.durationMs', { ms: r.duration_ms })}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'error' ? 'destructive' : 'outline'}>{statusLabel(r.status)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md break-all whitespace-normal">{r.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runs.hasNextPage && (
            <Button variant="outline" className="justify-self-center" onClick={() => void runs.fetchNextPage()}>
              {t('loadMore')}
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  )
}
