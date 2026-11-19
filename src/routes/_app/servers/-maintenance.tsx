import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import type { Job } from '@/api/types'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobProgress } from '@/components/JobProgress'
import type { ServerObject } from '@/components/ServerStatus'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatTime } from '@/lib/format'

import { DEFAULT_PORTS, Fields, serverQuery } from './-shared'
import { ChannelSelect, UpdateFailure, type Channel, type UpdateCheckItem, type UpdateTargetResult } from './-update'

interface ProbeResult {
  url: string
  reachable: boolean
  latency_ms: number
  error?: string
}

interface UninstallResult {
  scheduled_at: string
  status: string
}

const PROBE_TARGETS = ['master', 'recovery'] as const
type ProbeTarget = (typeof PROBE_TARGETS)[number]

// Maintenance 是详情页的维护页（web-console「服务器页」）：按风险从低到高排，卸载在最后（m2-10 design 第 1 条）。
// 能不能升级、端口是否冲突都由主控判定，页面原样显示主控的结果与错误。
export function Maintenance({ name }: { name: string }) {
  return (
    <div className="grid gap-4">
      <AgentUpdate name={name} />
      <ProbeMaster name={name} />
      <SwitchPorts name={name} />
      <Uninstall name={name} />
    </div>
  )
}

// AgentUpdate 点了才检查（主控要去发布源查、还要问一次节点）；结果只属于检查时的渠道，换渠道就不再显示（design 第 2 条）。
// 升级是危险类「重启」、长任务；受理后检查结果收起，要再升级得重新检查。
function AgentUpdate({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<Channel>('stable')
  const [job, setJob] = useState<Job | null>(null)
  const check = useMutation({ mutationFn: (ch: Channel) => run<UpdateCheckItem>('server update check', { args: [name], flags: { channel: ch } }) })
  const apply = useMutation({
    mutationFn: ({ version, ch }: { version: string; ch: Channel }) => run<Job>('server update apply', { args: [name, version], flags: { channel: ch }, confirm: name }),
    onSuccess: (accepted) => {
      setJob(accepted)
      check.reset()
    },
  })
  const c = check.data
  const onApply = async (version: string) => {
    const ok = await dialogs.confirm({ title: t('update.applyConfirmTitle', { name, version }), description: t('update.applyConfirmDescription'), value: name, destructive: true })
    if (ok) apply.mutate({ version, ch: channel })
  }
  const yesNo = (v: boolean) => (v ? t('update.yes') : t('update.no'))
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('update.title')}</CardTitle>
        <CardDescription>{t('update.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ChannelSelect
            id="update-channel"
            value={channel}
            onChange={(v) => {
              setChannel(v)
              check.reset()
            }}
          />
          <Button variant="outline" disabled={check.isPending} onClick={() => check.mutate(channel)}>
            {t('update.check')}
          </Button>
        </div>
        <ErrorNotice error={check.error} />
        {c && (
          <div className="grid gap-3" data-testid="update-check">
            <Fields
              rows={[
                [t('update.current'), <span className="font-mono">{c.current_version || t('update.unknownVersion')}</span>],
                [t('update.latest'), <span className="font-mono">{c.latest_version}</span>],
                [t('update.inDocker'), yesNo(c.in_docker)],
                [t('update.reachable'), yesNo(c.reachable)],
                [t('update.compatible'), yesNo(c.compatible)],
                [t('update.canApply'), c.can_apply ? t('update.canApplyYes') : t('update.canApplyNo', { reason: c.reason ?? '' })],
              ]}
            />
            {c.can_apply && (
              <div>
                <Button variant="destructive" disabled={apply.isPending} onClick={() => void onApply(c.latest_version)}>
                  {t('update.apply', { version: c.latest_version })}
                </Button>
              </div>
            )}
          </div>
        )}
        <ErrorNotice error={apply.error} />
        {job && (
          <JobProgress
            key={job.job_id}
            accepted={job}
            onFinish={(j) => {
              if (j.status === 'done') void queryClient.invalidateQueries({ queryKey: ['server get', name] })
            }}
            renderDone={(output) => {
              const r = output as UpdateTargetResult | null
              return <p>{t('update.done', { from: r?.from_version ?? '', to: r?.to_version ?? '' })}</p>
            }}
            renderFailed={(e) => <UpdateFailure state={e.body.state} />}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ProbeMaster 让节点用它记下的主控公钥对主控地址或恢复地址握手一次；只读，点了才请求，换目标就不再显示旧结果。
function ProbeMaster({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [target, setTarget] = useState<ProbeTarget>('master')
  const probe = useMutation({ mutationFn: (tg: ProbeTarget) => run<ProbeResult>('server probe-master-url', { args: [name], flags: { target: tg } }) })
  const p = probe.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('probe.title')}</CardTitle>
        <CardDescription>{t('probe.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={target}
            onValueChange={(v) => {
              setTarget(v as ProbeTarget)
              probe.reset()
            }}
          >
            <SelectTrigger aria-label={t('probe.target')} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROBE_TARGETS.map((tg) => (
                <SelectItem key={tg} value={tg}>
                  {t(`probe.targets.${tg}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={probe.isPending} onClick={() => probe.mutate(target)}>
            {t('probe.run')}
          </Button>
        </div>
        <ErrorNotice error={probe.error} />
        {p && (
          <div data-testid="probe-result">
            <Fields
              rows={[
                [t('probe.url'), <span className="font-mono">{p.url}</span>],
                [t('probe.result'), p.reachable ? t('probe.reachable', { ms: p.latency_ms }) : t('probe.unreachable')],
                ...(p.error ? ([[t('probe.error'), p.error]] as [string, string][]) : []),
              ]}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// SwitchPorts 是危险类「权限」：两个端口都可选，填了才发；两个都不填也照常发，由主控回 bad_request（design 第 5 条）。
// websocket 模式下节点不开端口，不显示（与 m2-08 隐藏寻址参数的理由相同）。
function SwitchPorts({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const server = useQuery(serverQuery(name))
  const [listen, setListen] = useState('')
  const [pull, setPull] = useState('')
  const change = useMutation({
    mutationFn: () =>
      run<ServerObject>('server switch-listen-port', {
        args: [name],
        flags: { 'listen-port': listen.trim() ? Number(listen) : undefined, 'pull-port': pull.trim() ? Number(pull) : undefined },
        confirm: name,
      }),
    onSuccess: async () => {
      setListen('')
      setPull('')
      await queryClient.invalidateQueries({ queryKey: ['server get', name] })
      toast.success(t('ports.done'))
    },
  })
  const spec = server.data?.spec
  if (!spec || spec.connection_mode === 'websocket') return null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await dialogs.confirm({ title: t('ports.confirmTitle', { name }), description: t('ports.confirmDescription'), value: name, destructive: true })
    if (ok) change.mutate()
  }
  return (
    <Card className="shadow-flat" data-testid="switch-ports">
      <CardHeader>
        <CardTitle>{t('ports.title')}</CardTitle>
        <CardDescription>{t('ports.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ports-listen">{t('ports.listen')}</Label>
              <Input
                id="ports-listen"
                type="number"
                inputMode="numeric"
                placeholder={t('ports.current', { port: spec.listen_port || DEFAULT_PORTS.listen })}
                value={listen}
                onChange={(e) => setListen(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ports-pull">{t('ports.pull')}</Label>
              <Input
                id="ports-pull"
                type="number"
                inputMode="numeric"
                placeholder={t('ports.current', { port: spec.pull_port || DEFAULT_PORTS.pull })}
                value={pull}
                onChange={(e) => setPull(e.target.value)}
              />
            </div>
          </div>
          <ErrorNotice error={change.error} />
          <div>
            <Button type="submit" variant="outline" disabled={change.isPending}>
              {t('ports.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// Uninstall 是危险类「主控自身」：确认框写全后果，确认值是服务器名；成功后概况与列表重新读取（design 第 6 条）。
function Uninstall({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const uninstall = useMutation({
    mutationFn: () => run<UninstallResult>('server uninstall', { args: [name], confirm: name }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: ['server get', name] }), queryClient.invalidateQueries({ queryKey: ['server list'] })]),
  })
  const onUninstall = async () => {
    const ok = await dialogs.confirm({ title: t('uninstall.confirmTitle', { name }), description: t('uninstall.confirmDescription'), value: name, destructive: true })
    if (ok) uninstall.mutate()
  }
  const u = uninstall.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('uninstall.title')}</CardTitle>
        <CardDescription>{t('uninstall.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <Button variant="destructive" disabled={uninstall.isPending} onClick={() => void onUninstall()}>
            {t('uninstall.button')}
          </Button>
        </div>
        <ErrorNotice error={uninstall.error} />
        {u && !uninstall.error && (
          <Alert data-testid="uninstall-result">
            <AlertDescription>{t('uninstall.done', { time: formatTime(u.scheduled_at) })}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
