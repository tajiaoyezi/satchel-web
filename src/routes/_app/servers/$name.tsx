import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { ServerStatusBadge, type ServerObject } from '@/components/ServerStatus'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyText } from '@/lib/clipboard'
import { formatBytes, formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/servers/$name')({ component: ServerPage })

// 概况与流量的自动刷新间隔（design 第 3 条）；连接清单不自动刷新。
const REFRESH_MS = 10_000

interface InstallCommand {
  server: string
  command: string
  master_url: string
  master_key_fingerprint: string
}

interface TrafficTotal {
  inbound: string
  outbound: string
  credential: string
  uplink: number
  downlink: number
}

interface TrafficView {
  since: string | null
  collected_at: string | null
  traffic: TrafficTotal[]
}

interface Connection {
  id: number
  network: string
  peer: string
  outbound: string
  start: string
}

interface LimitSource {
  source: string
  mbps: number
  deadline?: string
}

interface LimitResult {
  inbound: string
  credential: string
  sources: LimitSource[]
  limited: boolean
  effective_mbps: number
}

interface KickResult {
  kicked: number
}

interface RestartResult {
  running: boolean
  version?: string
  started_at?: string
  inbounds: string[]
}

type Tab = 'overview' | 'traffic' | 'connections' | 'limit' | 'kick'

// Target 是从流量表的一行带到连接、限速、踢线三个标签页的入站与凭据；seq 变了表单就按新值重建（design 第 2 条）。
interface Target {
  inbound: string
  credential: string
  seq: number
}

const SOURCES = ['static', 'master', 'node_rule'] as const

// 服务器详情页（web-console「服务器页」）：节点不在线时也照常发请求，错误由主控给出（design 第 5 条）。
function ServerPage() {
  const { name } = Route.useParams()
  return (
    <AdminPage title={name}>
      <ServerDetail name={name} />
    </AdminPage>
  )
}

function ServerDetail({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [tab, setTab] = useState<Tab>('overview')
  const [target, setTarget] = useState<Target>({ inbound: '', credential: '', seq: 0 })
  const pick = (next: Tab, row: TrafficTotal) => {
    setTarget((prev) => ({ inbound: row.inbound, credential: row.credential, seq: prev.seq + 1 }))
    setTab(next)
  }
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/servers">
            <ArrowLeft />
            {t('detail.back')}
          </Link>
        </Button>
        <div className="ml-auto">
          <RestartKernel name={name} />
        </div>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('detail.tabs.traffic')}</TabsTrigger>
          <TabsTrigger value="connections">{t('detail.tabs.connections')}</TabsTrigger>
          <TabsTrigger value="limit">{t('detail.tabs.limit')}</TabsTrigger>
          <TabsTrigger value="kick">{t('detail.tabs.kick')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          <Overview name={name} />
          <Install name={name} />
        </TabsContent>
        <TabsContent value="traffic">
          <Traffic name={name} onPick={pick} />
        </TabsContent>
        <TabsContent value="connections">
          <Connections key={target.seq} name={name} initial={target} />
        </TabsContent>
        <TabsContent value="limit">
          <Limit key={target.seq} name={name} initial={target} />
        </TabsContent>
        <TabsContent value="kick">
          <Kick key={target.seq} name={name} initial={target} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Fields 是两列的「名称 值」表。
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Overview({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const server = useQuery({
    queryKey: ['server get', name],
    queryFn: () => run<ServerObject>('server get', { args: [name] }),
    refetchInterval: REFRESH_MS,
  })
  const none = t('fields.none')
  const s = server.data?.status
  return (
    <Card className="shadow-flat">
      <CardContent className="grid gap-3">
        <ErrorNotice error={server.error} />
        {server.data && s && (
          <Fields
            rows={[
              [t('fields.status'), <ServerStatusBadge status={s.status} />],
              [t('fields.mode'), server.data.spec.connection_mode],
              [t('fields.ipv4'), <span className="font-mono">{s.ip_address || none}</span>],
              [t('fields.ipv6'), <span className="font-mono">{s.ip_address_v6 || none}</span>],
              [t('fields.lastHeartbeat'), s.last_heartbeat ? formatTime(s.last_heartbeat) : t('fields.noHeartbeat')],
              [t('fields.offlineSince'), s.offline_since ? formatTime(s.offline_since) : none],
              [t('fields.bootCount'), s.boot_count],
              [t('fields.core'), s.core_running ? t('fields.running') : t('fields.notRunning')],
              [t('fields.coreVersion'), s.core_version || none],
              [t('fields.coreBootTime'), s.core_boot_time ? formatTime(s.core_boot_time) : none],
              [t('fields.coreBootCount'), s.core_boot_count],
            ]}
          />
        )}
      </CardContent>
    </Card>
  )
}

// Install 点了才取安装命令：命令里带着 token 原文，不在打开页面时就取，也不留在缓存里（gcTime 0：离开页面就丢掉，
// 回来时不会不点按钮就显示上一次的命令）。
function Install({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [requested, setRequested] = useState(false)
  const install = useQuery({
    queryKey: ['server install-command', name],
    queryFn: () => run<InstallCommand>('server install-command', { args: [name] }),
    enabled: requested,
    gcTime: 0,
  })
  const fetchCommand = () => (requested ? void install.refetch() : setRequested(true))
  const copy = async (text: string) => {
    if (await copyText(text)) toast.success(t('actions.copied', { ns: 'common' }))
    else toast.error(t('actions.copyFailed', { ns: 'common' }))
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('install.title')}</CardTitle>
        <CardDescription>{t('install.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div>
          <Button variant="outline" disabled={install.isFetching} onClick={fetchCommand}>
            {t('install.fetch')}
          </Button>
        </div>
        <ErrorNotice error={install.error} />
        {requested && install.data && !install.error && (
          <>
            <pre className="bg-muted overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap break-all" data-testid="install-command">
              {install.data.command}
            </pre>
            <div>
              <Button size="sm" variant="outline" onClick={() => void copy(install.data.command)}>
                {t('actions.copy', { ns: 'common' })}
              </Button>
            </div>
            <Fields
              rows={[
                [t('install.masterUrl'), <span className="font-mono">{install.data.master_url}</span>],
                [t('install.fingerprint'), <span className="font-mono">{install.data.master_key_fingerprint}</span>],
              ]}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Traffic({ name, onPick }: { name: string; onPick: (tab: Tab, row: TrafficTotal) => void }) {
  const { t } = useTranslation('servers')
  const traffic = useQuery({
    queryKey: ['server traffic', name],
    queryFn: () => run<TrafficView>('server traffic', { args: [name] }),
    refetchInterval: REFRESH_MS,
  })
  const v = traffic.data
  const rows = v?.traffic ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription className="grid gap-1">
          <span>{t('traffic.description')}</span>
          {v && v.since && <span>{t('traffic.since', { time: formatTime(v.since) })}</span>}
          {v && (v.collected_at ? <span>{t('traffic.collectedAt', { time: formatTime(v.collected_at) })}</span> : <span>{t('traffic.notCollected')}</span>)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={traffic.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('traffic.inbound')}</TableHead>
              <TableHead>{t('traffic.outbound')}</TableHead>
              <TableHead>{t('traffic.credential')}</TableHead>
              <TableHead className="text-right">{t('traffic.uplink')}</TableHead>
              <TableHead className="text-right">{t('traffic.downlink')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && traffic.isSuccess && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {t('traffic.empty')}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={`${r.inbound}|${r.outbound}|${r.credential}`} data-testid={`traffic-${r.inbound}-${r.outbound}-${r.credential}`}>
                <TableCell className="font-mono">{r.inbound}</TableCell>
                <TableCell className="font-mono">{r.outbound}</TableCell>
                <TableCell className="font-mono">{r.credential}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(r.uplink)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(r.downlink)}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => onPick('connections', r)}>
                    {t('traffic.toConnections')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onPick('limit', r)}>
                    {t('traffic.toLimit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onPick('kick', r)}>
                    {t('traffic.toKick')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// TargetInputs 是入站与凭据两个输入框；inboundLabel 让踢线那一页写明入站可以不填。
function TargetInputs(props: { inbound: string; credential: string; setInbound: (v: string) => void; setCredential: (v: string) => void; inboundLabel?: string; idPrefix: string }) {
  const { t } = useTranslation('servers')
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${props.idPrefix}-inbound`}>{props.inboundLabel ?? t('target.inbound')}</Label>
        <Input id={`${props.idPrefix}-inbound`} placeholder={t('target.inboundHint')} value={props.inbound} onChange={(e) => props.setInbound(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${props.idPrefix}-credential`}>{t('target.credential')}</Label>
        <Input id={`${props.idPrefix}-credential`} placeholder={t('target.credentialHint')} value={props.credential} onChange={(e) => props.setCredential(e.target.value)} />
      </div>
    </div>
  )
}

// Connections 每次查询都经通道问节点，所以只在点「查询」「刷新」时请求（design 第 3 条）。
function Connections({ name, initial }: { name: string; initial: Target }) {
  const { t } = useTranslation('servers')
  const [inbound, setInbound] = useState(initial.inbound)
  const [credential, setCredential] = useState(initial.credential)
  const [applied, setApplied] = useState(initial.inbound && initial.credential ? { inbound: initial.inbound, credential: initial.credential } : null)
  const list = useInfiniteQuery({
    queryKey: ['server connections', name, applied?.inbound, applied?.credential],
    queryFn: ({ pageParam }) =>
      run<Page<Connection>>('server connections', { args: [name], flags: { inbound: applied?.inbound, credential: applied?.credential }, limit: 100, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: applied !== null,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next = { inbound: inbound.trim(), credential: credential.trim() }
    if (applied && applied.inbound === next.inbound && applied.credential === next.credential) void list.refetch()
    else setApplied(next)
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('connections.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="grid gap-3" onSubmit={submit}>
          <TargetInputs idPrefix="conn" inbound={inbound} credential={credential} setInbound={setInbound} setCredential={setCredential} />
          <div className="flex gap-2">
            <Button type="submit" disabled={!inbound.trim() || !credential.trim()}>
              {t('connections.search')}
            </Button>
            <Button type="button" variant="outline" disabled={applied === null || list.isFetching} onClick={() => void list.refetch()}>
              {t('connections.refresh')}
            </Button>
          </div>
        </form>
        <ErrorNotice error={list.error} />
        {applied && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('connections.id')}</TableHead>
                <TableHead>{t('connections.network')}</TableHead>
                <TableHead>{t('connections.peer')}</TableHead>
                <TableHead>{t('connections.outbound')}</TableHead>
                <TableHead>{t('connections.start')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 && list.isSuccess && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {t('connections.empty')}
                  </TableCell>
                </TableRow>
              )}
              {items.map((c, i) => (
                <TableRow key={`${c.id}-${i}`}>
                  <TableCell className="font-mono">{c.id}</TableCell>
                  <TableCell>{c.network}</TableCell>
                  <TableCell className="font-mono">{c.peer}</TableCell>
                  <TableCell className="font-mono">{c.outbound}</TableCell>
                  <TableCell>{formatTime(c.start)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('connections.loadMore')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// Limit 只动「主控临时」这一份；Mbps 与时长的取值由主控判定，这里只要求必填项非空（design 第 5 条）。
function Limit({ name, initial }: { name: string; initial: Target }) {
  const { t } = useTranslation('servers')
  const [inbound, setInbound] = useState(initial.inbound)
  const [credential, setCredential] = useState(initial.credential)
  const [mbps, setMbps] = useState('')
  const [expiresIn, setExpiresIn] = useState('')
  const limit = useMutation({
    mutationFn: (action: 'set' | 'clear') => {
      const target = { inbound: inbound.trim(), credential: credential.trim() }
      if (action === 'clear') return run<LimitResult>('server limit clear', { args: [name], flags: target })
      return run<LimitResult>('server limit set', { args: [name], flags: { ...target, mbps: Number(mbps), 'expires-in': expiresIn.trim() || undefined } })
    },
  })
  const targetFilled = inbound.trim() !== '' && credential.trim() !== ''
  const submit = (e: FormEvent) => {
    e.preventDefault()
    limit.mutate('set')
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('limit.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="grid gap-3" onSubmit={submit}>
          <TargetInputs idPrefix="limit" inbound={inbound} credential={credential} setInbound={setInbound} setCredential={setCredential} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="limit-mbps">{t('limit.mbps')}</Label>
              <Input id="limit-mbps" type="number" inputMode="numeric" value={mbps} onChange={(e) => setMbps(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="limit-expires">{t('limit.expiresIn')}</Label>
              <Input id="limit-expires" placeholder={t('limit.expiresInHint')} value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!targetFilled || mbps.trim() === '' || limit.isPending}>
              {t('limit.set')}
            </Button>
            <Button type="button" variant="outline" disabled={!targetFilled || limit.isPending} onClick={() => limit.mutate('clear')}>
              {t('limit.clear')}
            </Button>
          </div>
        </form>
        <ErrorNotice error={limit.error} />
        {limit.data && !limit.error && <LimitView result={limit.data} />}
      </CardContent>
    </Card>
  )
}

function LimitView({ result }: { result: LimitResult }) {
  const { t } = useTranslation('servers')
  const value = (s: LimitSource | undefined) => {
    if (!s) return t('limit.notSet')
    const v = s.mbps === 0 ? t('limit.unlimited') : t('limit.value', { mbps: s.mbps })
    return s.deadline ? t('limit.withDeadline', { value: v, time: formatTime(s.deadline) }) : v
  }
  const rows = SOURCES.map((src): [string, ReactNode] => [t(`limit.sources.${src}`), value(result.sources.find((s) => s.source === src))])
  return (
    <Alert data-testid="limit-result">
      <AlertTitle>{t('limit.result', { inbound: result.inbound, credential: result.credential })}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <Fields rows={rows} />
        <p className="font-medium">{result.limited ? t('limit.effective', { mbps: result.effective_mbps }) : t('limit.notLimited')}</p>
      </AlertDescription>
    </Alert>
  )
}

// Kick 不填入站时踢这个凭据在所有入站上的连接；踢线不是封禁（node-limiter）。
function Kick({ name, initial }: { name: string; initial: Target }) {
  const { t } = useTranslation('servers')
  const [inbound, setInbound] = useState(initial.inbound)
  const [credential, setCredential] = useState(initial.credential)
  const kick = useMutation({
    mutationFn: () => run<KickResult>('server kick', { args: [name], flags: { credential: credential.trim(), inbound: inbound.trim() || undefined } }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    kick.mutate()
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('kick.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="grid gap-3" onSubmit={submit}>
          <TargetInputs
            idPrefix="kick"
            inboundLabel={t('kick.inboundOptional')}
            inbound={inbound}
            credential={credential}
            setInbound={setInbound}
            setCredential={setCredential}
          />
          {!inbound.trim() && credential.trim() && <p className="text-muted-foreground text-sm">{t('kick.allInbounds', { credential: credential.trim() })}</p>}
          <div>
            <Button type="submit" variant="destructive" disabled={!credential.trim() || kick.isPending}>
              {t('kick.submit')}
            </Button>
          </div>
        </form>
        <ErrorNotice error={kick.error} />
        {kick.data && !kick.error && (
          <Alert data-testid="kick-result">
            <AlertDescription>{t('kick.result', { count: kick.data.kicked })}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

// RestartKernel 是危险类「重启」：先弹危险确认，确认值是服务器名（design 第 7 条）。
function RestartKernel({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const restart = useMutation({
    mutationFn: () => run<RestartResult>('server restart-kernel', { args: [name], confirm: name }),
    onSuccess: () =>
      Promise.all([queryClient.invalidateQueries({ queryKey: ['server get', name] }), queryClient.invalidateQueries({ queryKey: ['server traffic', name] })]),
  })
  const onRestart = async () => {
    const ok = await dialogs.confirm({ title: t('restart.confirmTitle', { name }), description: t('restart.confirmDescription'), value: name, destructive: true })
    if (ok) restart.mutate()
  }
  const r = restart.data
  return (
    <div className="grid justify-items-end gap-2">
      <Button variant="destructive" size="sm" disabled={restart.isPending} onClick={() => void onRestart()}>
        {t('restart.button')}
      </Button>
      <ErrorNotice error={restart.error} />
      {r && !restart.error && (
        <Alert data-testid="restart-result" className="text-left">
          <AlertTitle>{t('restart.done')}</AlertTitle>
          <AlertDescription>
            <Fields
              rows={[
                [t('fields.core'), r.running ? t('fields.running') : t('fields.notRunning')],
                [t('fields.coreVersion'), r.version || t('fields.none')],
                [t('restart.startedAt'), r.started_at ? formatTime(r.started_at) : t('fields.none')],
                [t('fields.inbounds'), r.inbounds.length > 0 ? r.inbounds.join(', ') : t('fields.none')],
              ]}
            />
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
