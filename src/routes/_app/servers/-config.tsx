import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBytes, formatTime } from '@/lib/format'

import { Fields } from './-shared'

// 详情页的「节点配置」（web-console「服务器页」，m2-16 design 第 6 条）：四样都要经通道问节点，点了才请求，结果留在页面上。

interface ConfigStatus {
  exists: boolean
  hash: string
  applied_hash: string
  desired_hash?: string
  in_sync: boolean
  applied_generation: number
  inbounds: string[] | null
  kernel_running: boolean
  kernel_version?: string
  size: number
  modified?: string
}

interface ConfigFile {
  scope: string
  path: string
  size: number
  modified: string
}

interface ConfigRead {
  path: string
  content: string
  truncated?: boolean
  redacted: boolean
}

interface ConfigTest {
  ok: boolean
  error?: string
  inbounds: string[] | null
  hash: string
}

const SCOPES = ['all', 'kernel', 'nginx'] as const
type Scope = (typeof SCOPES)[number]

export function ConfigTab({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [scope, setScope] = useState<Scope>('all')
  const status = useMutation({ mutationFn: () => run<ConfigStatus>('server config status', { args: [name] }) })
  const test = useMutation({ mutationFn: () => run<ConfigTest>('server config test', { args: [name] }) })
  const files = useMutation({ mutationFn: (s: Scope) => run<Page<ConfigFile>>('server config files', { args: [name], flags: { scope: s }, limit: 100 }) })
  const read = useMutation({ mutationFn: (path: string) => run<ConfigRead>('server config read', { args: [name], flags: { path } }) })
  const s = status.data
  const yesNo = (v: boolean) => (v ? t('config.yes') : t('config.no'))
  return (
    <div className="grid gap-4">
      <Card className="shadow-flat">
        <CardHeader>
          <CardTitle>{t('config.statusTitle')}</CardTitle>
          <CardDescription>{t('config.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={status.isPending} onClick={() => status.mutate()}>
              {t('config.status')}
            </Button>
            <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
              {t('config.test')}
            </Button>
          </div>
          <ErrorNotice error={status.error} />
          {s && (
            <div className="grid gap-2" data-testid="config-status">
              <p>
                <Badge variant={s.in_sync ? 'default' : 'destructive'}>{s.in_sync ? t('config.inSync') : t('config.outOfSync')}</Badge>
              </p>
              <Fields
                rows={[
                  [t('config.exists'), yesNo(s.exists)],
                  [t('config.nodeHash'), <span className="font-mono text-xs">{s.hash || t('config.none')}</span>],
                  [t('config.appliedHash'), <span className="font-mono text-xs">{s.applied_hash || t('config.none')}</span>],
                  [t('config.desiredHash'), <span className="font-mono text-xs">{s.desired_hash || t('config.none')}</span>],
                  [t('config.generation'), s.applied_generation],
                  [t('config.inbounds'), (s.inbounds ?? []).join(', ') || t('config.none')],
                  [t('config.kernel'), s.kernel_running ? t('config.kernelRunning', { version: s.kernel_version ?? '' }) : t('config.kernelStopped')],
                  [t('config.size'), formatBytes(s.size)],
                  [t('config.modified'), s.modified ? formatTime(s.modified) : t('config.none')],
                ]}
              />
            </div>
          )}
          <ErrorNotice error={test.error} />
          {test.data && (
            <Alert variant={test.data.ok ? 'default' : 'destructive'} data-testid="config-test">
              <AlertDescription className="grid gap-1">
                <p>{test.data.ok ? t('config.testOk') : t('config.testFailed')}</p>
                {test.data.error && <p className="break-all">{test.data.error}</p>}
                {(test.data.inbounds ?? []).length > 0 && <p>{t('config.testInbounds', { inbounds: (test.data.inbounds ?? []).join(', ') })}</p>}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      <Card className="shadow-flat">
        <CardHeader>
          <CardTitle>{t('config.filesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger aria-label={t('config.scope')} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((sc) => (
                  <SelectItem key={sc} value={sc}>
                    {t(`config.scopes.${sc}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={files.isPending} onClick={() => files.mutate(scope)}>
              {t('config.listFiles')}
            </Button>
          </div>
          <ErrorNotice error={files.error} />
          {files.data && (
            <Table data-testid="config-files">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('config.path')}</TableHead>
                  <TableHead>{t('config.scope')}</TableHead>
                  <TableHead className="text-right">{t('config.size')}</TableHead>
                  <TableHead>{t('config.modified')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.data.items.map((f) => (
                  <TableRow key={f.path}>
                    <TableCell>
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => read.mutate(f.path)}>
                        {f.path}
                      </Button>
                    </TableCell>
                    <TableCell>{t(`config.scopes.${f.scope}` as 'config.scopes.all', { defaultValue: f.scope })}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(f.size)}</TableCell>
                    <TableCell>{formatTime(f.modified)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <ErrorNotice error={read.error} />
          {read.data && (
            <div className="grid gap-2" data-testid="config-read">
              <p className="font-mono text-xs">{read.data.path}</p>
              {read.data.redacted && <p className="text-muted-foreground">{t('config.redacted')}</p>}
              {read.data.truncated && <p className="text-muted-foreground">{t('config.truncated')}</p>}
              <pre className="bg-muted max-h-[32rem] overflow-auto rounded-md p-3 font-mono text-xs">{read.data.content}</pre>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
