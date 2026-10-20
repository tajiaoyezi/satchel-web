import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Job } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobProgress } from '@/components/JobProgress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const Route = createFileRoute('/_app/update')({ component: UpdatePage })

// UpdateCheck 是 update check 的输出（master-self-update）。
interface UpdateCheck {
  current_version: string
  latest_version: string
  has_update: boolean
  channel: string
  prerelease: boolean
  release_url: string
  notes: string
  source: string
  cdn: { enabled: boolean; used: boolean; reason?: string }
  can_apply: boolean
  reason?: string
}

const CHANNELS = ['stable', 'prerelease'] as const

// 升级页（web-console「升级页」）：按渠道检查更新；有更新且能自升级时，危险确认（确认值是版本号）后升级，跟踪进度；
// 主控原地重启期间连不上时接着查；完成后提示刷新页面，加载新版本的网页。
function UpdatePage() {
  const { t } = useTranslation('update')
  return (
    <AdminPage title={t('title')}>
      <UpdateBody />
    </AdminPage>
  )
}

function UpdateBody() {
  const { t } = useTranslation('update')
  const dialogs = useDialogs()
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>('stable')
  const [job, setJob] = useState<Job | null>(null)
  const check = useQuery({ queryKey: ['update check', channel], queryFn: () => run<UpdateCheck>('update check', { flags: { channel } }) })
  const apply = useMutation({
    mutationFn: (version: string) => run<Job>('update apply', { args: [version], confirm: version, flags: { channel } }),
    onSuccess: setJob,
  })
  const onApply = async (version: string) => {
    if (!(await dialogs.confirm({ title: t('applyConfirm.title', { version }), description: t('applyConfirm.description'), value: version, destructive: true }))) return
    apply.mutate(version)
  }
  const c = check.data
  return (
    <Card className="shadow-flat">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <Select value={channel} onValueChange={(v) => setChannel(v as (typeof CHANNELS)[number])}>
          <SelectTrigger aria-label={t('channel')} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CHANNELS.map((ch) => (
              <SelectItem key={ch} value={ch}>
                {t(`channels.${ch}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={check.isFetching} onClick={() => void check.refetch()}>
          {t('recheck')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <ErrorNotice error={check.error} />
        {c && (
          <>
            <div className="grid gap-1">
              <p>{t('current', { version: c.current_version })}</p>
              <p className="flex flex-wrap items-center gap-2">
                {t('latest', { version: c.latest_version })}
                <Badge variant={c.has_update ? 'default' : 'outline'}>{c.has_update ? t('hasUpdate') : t('upToDate')}</Badge>
              </p>
              <p className="text-muted-foreground">{t('source', { source: c.source })}</p>
              <p className="text-muted-foreground flex flex-wrap gap-x-3">
                <span>{c.cdn.enabled ? t('cdn.enabled') : t('cdn.disabled')}</span>
                <span>{c.cdn.used ? t('cdn.used') : t('cdn.notUsed')}</span>
                {c.cdn.reason && <span>{t('cdn.reason', { reason: c.cdn.reason })}</span>}
              </p>
              {c.release_url && (
                <a className="text-primary underline-offset-4 hover:underline" href={c.release_url} target="_blank" rel="noreferrer">
                  {t('releasePage')}
                </a>
              )}
            </div>
            <div className="grid gap-1">
              <h3 className="font-medium">{t('notes')}</h3>
              {c.notes ? <pre className="bg-muted max-h-80 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">{c.notes}</pre> : <p className="text-muted-foreground">{t('noNotes')}</p>}
            </div>
            {!c.can_apply && c.reason && (
              <Alert>
                <AlertDescription>
                  {t('cannotApply')}
                  {c.reason}
                </AlertDescription>
              </Alert>
            )}
            {c.has_update && c.can_apply && !job && (
              <Button variant="destructive" className="justify-self-start" disabled={apply.isPending} onClick={() => void onApply(c.latest_version)}>
                {t('apply', { version: c.latest_version })}
              </Button>
            )}
          </>
        )}
        <ErrorNotice error={apply.error} />
        {job && (
          <JobProgress
            key={job.job_id}
            accepted={job}
            renderDone={(out) => {
              const r = (out ?? {}) as { from_version?: string; to_version?: string }
              return (
                <Alert>
                  <AlertDescription className="grid gap-2">
                    <p>{t('done', { from: r.from_version ?? '', to: r.to_version ?? '' })}</p>
                    <Button className="justify-self-start" onClick={() => window.location.reload()}>
                      {t('reload')}
                    </Button>
                  </AlertDescription>
                </Alert>
              )
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
