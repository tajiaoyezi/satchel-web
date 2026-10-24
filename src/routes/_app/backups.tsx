import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { download, run, upload, type Verification } from '@/api/client'
import { settingsShowQuery } from '@/api/queries'
import { healthz } from '@/api/session'
import type { Job, Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobProgress } from '@/components/JobProgress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBytes, formatTime } from '@/lib/format'
import { loadPage, waitForRestart } from '@/lib/restart'

export const Route = createFileRoute('/_app/backups')({ component: BackupsPage })

interface Backup {
  name: string
  size: number
  created_at: string | null
  driver: string
}

// LastRestore 是 settings show 里运行态的 last_restore（master-backup「恢复之后的收尾」）。
interface LastRestore {
  source: string
  backup: string
  at: string
  result: 'ok' | 'failed' | string
  error?: string
  recovery_codes_file?: string
}

type Stage = 'idle' | 'restarting' | 'back' | 'stuck'

// 备份与恢复页（web-console「备份与恢复页」）：列出、生成（跟踪 job）、上传备份；下载与恢复是人类专属，要当场验证；
// 恢复之后主控重启，页面等它起来再重新读，会话没了就回登录页。
function BackupsPage() {
  const { t } = useTranslation('backups')
  return (
    <AdminPage title={t('title')}>
      <BackupsBody />
      <LastRestoreCard />
    </AdminPage>
  )
}

function BackupsBody() {
  const { t } = useTranslation('backups')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<Stage>('idle')
  const list = useInfiniteQuery({
    queryKey: ['backup list'],
    queryFn: ({ pageParam }) => run<Page<Backup>>('backup list', { limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['backup list'] })
  const create = useMutation({ mutationFn: () => run<Job>('backup create'), onSuccess: setJob })
  const send = useMutation({
    mutationFn: (file: File) => {
      setProgress(0)
      return upload<Backup>('backup upload', file, { onProgress: setProgress })
    },
    onSuccess: async (b) => {
      await refresh()
      toast.success(t('uploaded', { name: b.name }))
    },
    onSettled: () => {
      if (fileInput.current) fileInput.current.value = ''
    },
  })
  const save = useMutation({
    mutationFn: ({ name, verify }: { name: string; verify: Verification }) => download('backup download', { args: [name], verify, fallbackName: name }),
    onSuccess: (res) => toast.success(t('saved', { name: res.name })),
  })
  const restore = useMutation({
    mutationFn: ({ name, verify }: { name: string; verify: Verification }) => run('backup restore', { args: [name], verify }),
    onSuccess: async () => {
      setStage('restarting')
      try {
        await waitForRestart(healthz)
      } catch {
        setStage('stuck') // 等满上限还连不上：说明可能的原因，请人查过后刷新
        return
      }
      setStage('back')
      // 整页重新加载本页，品牌等换成恢复后的。恢复成功时所有会话都没了，守卫转到登录页、登录后回到本页；
      // 恢复失败时会话还在，留在本页看上一次恢复。
      loadPage('/backups')
    },
  })
  const onDownload = async (name: string) => {
    const verify = await dialogs.verify()
    if (verify) save.mutate({ name, verify })
  }
  const onRestore = async (name: string) => {
    if (!(await dialogs.confirm({ title: t('restoreConfirm.title', { name }), description: t('restoreConfirm.description'), confirmLabel: t('restoreConfirm.confirm'), destructive: true }))) return
    const verify = await dialogs.verify()
    if (verify) restore.mutate({ name, verify })
  }
  const busy = create.isPending || send.isPending || restore.isPending || stage === 'restarting'
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('description')}</CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => create.mutate()}>
            {t('create')}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('upload')}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            data-testid="backup-file"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) send.mutate(f)
            }}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {send.isPending && (
          <div className="grid gap-1 text-sm">
            <p>{t('uploading', { percent: Math.round(progress * 100) })}</p>
            <div className="bg-muted h-2 overflow-hidden rounded" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="bg-primary h-full" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}
        {job && (
          <JobProgress
            key={job.job_id}
            accepted={job}
            onFinish={() => void refresh()}
            renderDone={(out) => <p>{t('created', { name: (out as { name?: string } | null)?.name ?? '' })}</p>}
          />
        )}
        {stage === 'restarting' && (
          <div className="grid gap-1 text-sm" role="status">
            <p>{t('restarting')}</p>
            <p className="text-muted-foreground">{t('foreground')}</p>
          </div>
        )}
        {stage === 'back' && <p className="text-sm">{t('back')}</p>}
        {stage === 'stuck' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('restore.stuck', { ns: 'setup' })}</AlertDescription>
          </Alert>
        )}
        <ErrorNotice error={list.error ?? create.error ?? send.error ?? save.error ?? restore.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.size')}</TableHead>
              <TableHead>{t('columns.createdAt')}</TableHead>
              <TableHead>{t('columns.driver')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.name} data-testid={`backup-${b.name}`}>
                <TableCell className="font-mono">{b.name}</TableCell>
                <TableCell>{formatBytes(b.size)}</TableCell>
                <TableCell>{formatTime(b.created_at)}</TableCell>
                <TableCell>{b.driver}</TableCell>
                <TableCell className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => void onDownload(b.name)}>
                    {t('download')}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onRestore(b.name)}>
                    {t('restore')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
        <p className="text-muted-foreground text-xs">{t('downloadHint')}</p>
      </CardContent>
    </Card>
  )
}

// asLastRestore 认出 last_restore：还没恢复过时它是空的。
function asLastRestore(v: unknown): LastRestore | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Partial<LastRestore>
  return typeof r.backup === 'string' && typeof r.result === 'string' ? (r as LastRestore) : null
}

// LastRestoreCard 显示上一次恢复（settings show 的 last_restore），与系统设置页共用 settings show 的查询。
function LastRestoreCard() {
  const { t } = useTranslation('backups')
  const show = useQuery(settingsShowQuery)
  const last = asLastRestore(show.data?.status.last_restore)
  if (!last) return null
  return (
    <Card className="shadow-flat" data-testid="last-restore">
      <CardHeader>
        <CardTitle>{t('last.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">{t('last.source')}</dt>
          <dd>{t(`sources.${last.source}` as 'sources.manual', { defaultValue: last.source })}</dd>
          <dt className="text-muted-foreground">{t('last.backup')}</dt>
          <dd className="font-mono">{last.backup}</dd>
          <dt className="text-muted-foreground">{t('last.at')}</dt>
          <dd>{formatTime(last.at)}</dd>
          <dt className="text-muted-foreground">{t('last.result')}</dt>
          <dd>{last.result === 'ok' ? t('last.ok') : t('last.failed')}</dd>
        </dl>
        {last.result !== 'ok' && last.error && (
          <Alert variant="destructive">
            <AlertDescription>{t('last.error', { error: last.error })}</AlertDescription>
          </Alert>
        )}
        {last.recovery_codes_file && (
          <p className="break-all">{t('last.codes', { file: last.recovery_codes_file })}</p>
        )}
      </CardContent>
    </Card>
  )
}
