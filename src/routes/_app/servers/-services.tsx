import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run, type Verification } from '@/api/client'
import type { Job, Page } from '@/api/types'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobProgress } from '@/components/JobProgress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'

import { Fields, serverQuery } from './-shared'

// 服务器详情页的「服务」标签页（web-console「服务器详情页的服务标签页」，m2-22 design 第 5、8 条）：
// 第一次打开时才请求。与主控同机的服务器上，nginx 的启停、安装、卸载与清理 stream 在危险确认之后再当场验证，
// 网页按 server get 的 same_host_as_master 提前弹验证，不等主控回 human_required。

interface ServiceStatus {
  kernel: { running: boolean; version?: string; started_at?: string | null }
  nginx: { installed: boolean; running: boolean; version?: string; in_docker: boolean; init_system?: string; config_ok: boolean; error?: string }
  agent: { running: boolean; version?: string; uptime_seconds: number; in_docker: boolean }
  checked_at: string
}

interface ControlResult {
  service: string
  action: string
  running: boolean
  message?: string
}

interface NginxBlock {
  kind: string
  conf_path: string
  managed: boolean
  server_names: string[] | null
  listen_ports: string[] | null
  proxy_pass?: string
  root?: string
  has_ssl: boolean
}

interface ClearResult {
  port: number
  removed_files: string[] | null
  reloaded: boolean
  rolled_back?: boolean
  rollback_error?: string
  message?: string
}

type Service = 'kernel' | 'nginx'
const ACTIONS: Record<Service, string[]> = { kernel: ['start', 'stop', 'restart'], nginx: ['start', 'stop', 'restart', 'reload'] }

// useHumanCheck 返回一个函数：同机服务器上弹当场验证（取消时回 null），否则直接回 undefined（不带验证）。
function useHumanCheck(sameHost: boolean) {
  const dialogs = useDialogs()
  return async (): Promise<Verification | undefined | null> => (sameHost ? dialogs.verify() : undefined)
}

export function ServicesTab({ name, enabled }: { name: string; enabled: boolean }) {
  const { t } = useTranslation('servers')
  const sameHost = useQuery(serverQuery(name)).data?.status.same_host_as_master === true
  return (
    <div className="grid gap-4">
      {sameHost && (
        <Alert data-testid="services-same-host">
          <AlertDescription>{t('services.sameHost')}</AlertDescription>
        </Alert>
      )}
      <StatusCard name={name} enabled={enabled} />
      <Control name={name} sameHost={sameHost} />
      <Nginx name={name} sameHost={sameHost} />
      <NginxServers name={name} enabled={enabled} />
      <ClearStream name={name} sameHost={sameHost} />
    </div>
  )
}

const statusKey = (name: string) => ['server service status', name]

function StatusCard({ name, enabled }: { name: string; enabled: boolean }) {
  const { t } = useTranslation('servers')
  const status = useQuery({ queryKey: statusKey(name), queryFn: () => run<ServiceStatus>('server service status', { args: [name] }), enabled })
  const s = status.data
  const state = (running: boolean) => <Badge variant={running ? 'default' : 'outline'}>{running ? t('services.running') : t('services.stopped')}</Badge>
  const yesNo = (v: boolean) => (v ? t('services.yes') : t('services.no'))
  return (
    <Card className="shadow-flat">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle>{t('services.statusTitle')}</CardTitle>
        {s && <CardDescription>{t('services.checkedAt', { time: formatTime(s.checked_at) })}</CardDescription>}
        <Button className="ml-auto" size="sm" variant="outline" disabled={status.isFetching} onClick={() => void status.refetch()}>
          {t('services.refresh')}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ErrorNotice error={status.error} />
        {s && (
          <div className="grid gap-4 sm:grid-cols-3" data-testid="service-status">
            <section className="grid gap-2" data-testid="service-kernel">
              <h3 className="text-sm font-medium">{t('services.kernel')}</h3>
              <Fields
                rows={[
                  [t('services.state'), state(s.kernel.running)],
                  [t('services.version'), s.kernel.version || t('fields.none')],
                  [t('services.startedAt'), s.kernel.started_at ? formatTime(s.kernel.started_at) : t('fields.none')],
                ]}
              />
            </section>
            <section className="grid gap-2" data-testid="service-nginx">
              <h3 className="text-sm font-medium">{t('services.nginx')}</h3>
              <Fields
                rows={[
                  [t('services.installState'), s.nginx.installed ? t('services.installed') : t('services.notInstalled')],
                  [t('services.state'), state(s.nginx.running)],
                  [t('services.version'), s.nginx.version || t('fields.none')],
                  [t('services.inDocker'), yesNo(s.nginx.in_docker)],
                  [t('services.initSystem'), s.nginx.init_system || t('fields.none')],
                  [t('services.configOk'), s.nginx.config_ok ? t('services.configPass') : t('services.configFail')],
                  ...(s.nginx.error ? [[t('services.error'), <span className="break-all">{s.nginx.error}</span>] as [string, ReactNode]] : []),
                ]}
              />
            </section>
            <section className="grid gap-2" data-testid="service-agent">
              <h3 className="text-sm font-medium">{t('services.agent')}</h3>
              <Fields
                rows={[
                  [t('services.state'), state(s.agent.running)],
                  [t('services.version'), s.agent.version || t('fields.none')],
                  [t('services.uptime'), t('services.uptimeValue', { seconds: s.agent.uptime_seconds })],
                  [t('services.inDocker'), yesNo(s.agent.in_docker)],
                ]}
              />
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Control 是危险类「重启」，确认值是服务器名；同机服务器上控制 nginx 还要当场验证，kernel 不用。agent 不在选项里。
function Control({ name, sameHost }: { name: string; sameHost: boolean }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const human = useHumanCheck(sameHost)
  const [service, setService] = useState<Service>('nginx')
  const [action, setAction] = useState('restart')
  const control = useMutation({
    mutationFn: ({ verify }: { verify?: Verification }) => run<ControlResult>('server service control', { args: [name], flags: { service, action }, confirm: name, verify }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: statusKey(name) }),
  })
  const pickService = (v: string) => {
    setService(v as Service)
    if (!ACTIONS[v as Service].includes(action)) setAction('restart')
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const labels = { service: t(`services.${service}`), action: t(`services.actions.${action}` as 'services.actions.start'), name }
    const ok = await dialogs.confirm({ title: t('services.controlConfirmTitle', labels), description: t('services.controlConfirmDescription'), value: name, destructive: true })
    if (!ok) return
    const verify = service === 'nginx' ? await human() : undefined
    if (verify === null) return
    control.mutate({ verify })
  }
  const r = control.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('services.controlTitle')}</CardTitle>
        <CardDescription>{t('services.controlDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
          <div className="grid gap-1.5">
            <Label htmlFor="service-name">{t('services.service')}</Label>
            <Select value={service} onValueChange={pickService}>
              <SelectTrigger id="service-name" aria-label={t('services.service')} className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="kernel">{t('services.kernel')}</SelectItem>
                <SelectItem value="nginx">{t('services.nginx')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="service-action">{t('services.action')}</Label>
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger id="service-action" aria-label={t('services.action')} className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTIONS[service].map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`services.actions.${a}` as 'services.actions.start')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" variant="destructive" disabled={control.isPending}>
            {t('services.run')}
          </Button>
        </form>
        <ErrorNotice error={control.error} />
        {r && (
          <Alert data-testid="service-control-result">
            <AlertDescription>
              {t('services.controlDone', { service: t(`services.${r.service}` as 'services.nginx', { defaultValue: r.service }), state: r.running ? t('services.running') : t('services.stopped') })}
              {r.message ? ` ${r.message}` : ''}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

// Nginx：安装与卸载都是长任务；卸载是危险类「删除」。同机服务器上两条都要当场验证。完成后服务状态重新读取。
function Nginx({ name, sameHost }: { name: string; sameHost: boolean }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const human = useHumanCheck(sameHost)
  const [job, setJob] = useState<Job | null>(null)
  const install = useMutation({ mutationFn: (verify?: Verification) => run<Job>('server nginx install', { args: [name], verify }), onSuccess: setJob })
  const uninstall = useMutation({ mutationFn: (verify?: Verification) => run<Job>('server nginx uninstall', { args: [name], confirm: name, verify }), onSuccess: setJob })
  const onInstall = async () => {
    const verify = await human()
    if (verify === null) return
    uninstall.reset()
    install.mutate(verify)
  }
  const onUninstall = async () => {
    const ok = await dialogs.confirm({ title: t('services.uninstallConfirmTitle', { name }), description: t('services.uninstallConfirmDescription'), value: name, destructive: true })
    if (!ok) return
    const verify = await human()
    if (verify === null) return
    install.reset()
    uninstall.mutate(verify)
  }
  const busy = install.isPending || uninstall.isPending
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('services.nginxTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void onInstall()}>
            {t('services.install')}
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void onUninstall()}>
            {t('services.uninstall')}
          </Button>
        </div>
        <ErrorNotice error={install.error ?? uninstall.error} />
        {job && (
          <JobProgress
            key={job.job_id}
            accepted={job}
            onFinish={() => {
              void queryClient.invalidateQueries({ queryKey: statusKey(name) })
              void queryClient.invalidateQueries({ queryKey: ['server nginx servers', name] })
            }}
            renderDone={(output) => {
              // 节点的 message 原样附上：比如没装 nginx 时卸载也回 uninstalled，message 写明节点未安装
              const r = output as { installed?: boolean; already_installed?: boolean; uninstalled?: boolean; version?: string; message?: string } | null
              const text = r?.uninstalled ? t('services.uninstallDone') : r?.already_installed ? t('services.alreadyInstalled') : t('services.installDone', { version: r?.version ? ` ${r.version}` : '' })
              return (
                <p data-testid="nginx-job-done">
                  {text}
                  {r?.message ? ` ${r.message}` : ''}
                </p>
              )
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

function NginxServers({ name, enabled }: { name: string; enabled: boolean }) {
  const { t } = useTranslation('servers')
  const list = useInfiniteQuery({
    queryKey: ['server nginx servers', name],
    queryFn: ({ pageParam }) => run<Page<NginxBlock>>('server nginx servers', { args: [name], limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const yesNo = (v: boolean) => (v ? t('services.yes') : t('services.no'))
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('services.serversTitle')}</CardTitle>
        <CardDescription>{t('services.serversDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table data-testid="nginx-servers">
          <TableHeader>
            <TableRow>
              <TableHead>{t('services.cols.kind')}</TableHead>
              <TableHead>{t('services.cols.confPath')}</TableHead>
              <TableHead>{t('services.cols.managed')}</TableHead>
              <TableHead>{t('services.cols.serverNames')}</TableHead>
              <TableHead>{t('services.cols.listenPorts')}</TableHead>
              <TableHead>{t('services.cols.target')}</TableHead>
              <TableHead>{t('services.cols.ssl')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  {t('services.serversEmpty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.conf_path + (b.server_names ?? []).join(',') + (b.listen_ports ?? []).join(',')}>
                <TableCell>{b.kind}</TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">{b.conf_path}</TableCell>
                <TableCell>{yesNo(b.managed)}</TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">{(b.server_names ?? []).join(', ') || t('fields.none')}</TableCell>
                <TableCell>{(b.listen_ports ?? []).join(', ') || t('fields.none')}</TableCell>
                <TableCell className="font-mono text-xs break-all whitespace-normal">{b.proxy_pass || b.root || t('fields.none')}</TableCell>
                <TableCell>{yesNo(b.has_ssl)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('list.loadMore')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// ClearStream 是危险类「删除」，确认值是服务器名；同机服务器上还要当场验证。成功后服务状态与巡检重新读取。
function ClearStream({ name, sameHost }: { name: string; sameHost: boolean }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const human = useHumanCheck(sameHost)
  const [port, setPort] = useState('')
  const clear = useMutation({
    mutationFn: ({ p, verify }: { p: number; verify?: Verification }) => run<ClearResult>('server nginx clear-stream', { args: [name], flags: { port: p }, confirm: name, verify }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: statusKey(name) }), queryClient.invalidateQueries({ queryKey: ['server nginx servers', name] })]),
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const p = Number(port)
    const ok = await dialogs.confirm({ title: t('services.clearConfirmTitle', { name, port: p }), description: t('services.clearConfirmDescription'), value: name, destructive: true })
    if (!ok) return
    const verify = await human()
    if (verify === null) return
    clear.mutate({ p, verify })
  }
  const r = clear.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('services.clearTitle')}</CardTitle>
        <CardDescription>{t('services.clearDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void submit(e)}>
          <div className="grid gap-1.5">
            <Label htmlFor="clear-port">{t('services.port')}</Label>
            <Input id="clear-port" type="number" min={1} max={65535} className="w-32" value={port} onChange={(e) => setPort(e.target.value)} />
          </div>
          <Button type="submit" variant="destructive" disabled={port.trim() === '' || clear.isPending}>
            {t('services.clear')}
          </Button>
        </form>
        <ErrorNotice error={clear.error} />
        {r && (
          <Alert data-testid="clear-result">
            <AlertDescription className="grid gap-1">
              {(r.removed_files ?? []).length > 0 ? (
                <span className="break-all">{t('services.removed', { files: (r.removed_files ?? []).join(', ') })}</span>
              ) : (
                <span>{t('services.noFiles')}</span>
              )}
              <span>{r.reloaded ? t('services.reloaded') : t('services.notReloaded')}</span>
              {r.rolled_back && <span>{t('services.rolledBack')}</span>}
              {r.rollback_error && <span>{t('services.rollbackError', { error: r.rollback_error })}</span>}
              {r.message && <span>{r.message}</span>}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
