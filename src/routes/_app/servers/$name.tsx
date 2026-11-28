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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyText } from '@/lib/clipboard'
import { useDashboardFeed, type DashboardFeed } from '@/lib/dashboard'
import { formatBytes, formatSpeed, formatTime } from '@/lib/format'

import { Maintenance } from './-maintenance'
import { ConfigTab } from './-config'
import { EditTab } from './-edit'
import { ServicesTab } from './-services'
import { DEFAULT_PORTS, Fields, REFRESH_MS, serverQuery } from './-shared'
import { LogsTab, SystemTab, TrafficStats, type TrafficStatsView } from './-telemetry'

export const Route = createFileRoute('/_app/servers/$name')({ component: ServerPage })

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

// SpeedView 是 server speed <名字> 的输出（读主控内存，不问节点）。
interface SpeedView {
  upload_speed: number
  download_speed: number
  updated_at: string | null
}

interface TrafficView extends TrafficStatsView {
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

type Tab = 'overview' | 'credentials' | 'traffic' | 'connections' | 'limit' | 'kick' | 'system' | 'logs' | 'config' | 'services' | 'edit' | 'maintenance'
type FormTab = 'connections' | 'limit' | 'kick'

// Target 是从流量表的一行带到连接、限速、踢线某一页的入站与凭据。三页各有一份：点哪个入口只重建哪一页，
// 别的页的表单与结果不动；seq 变了那一页就按新值重建（design 第 2 条）。
interface Target {
  inbound: string
  credential: string
  seq: number
}

const EMPTY_TARGET: Target = { inbound: '', credential: '', seq: 0 }

const SOURCES = ['static', 'master', 'node_rule'] as const

// 服务器详情页（web-console「服务器页」）：节点不在线时也照常发请求，错误由主控给出（design 第 5 条）。
function ServerPage() {
  const { name } = Route.useParams()
  return (
    <AdminPage title={name}>
      {/* key：换一台服务器时从头开始，不把上一台的表单、结果与安装命令带过去 */}
      <ServerDetail key={name} name={name} />
    </AdminPage>
  )
}

function ServerDetail({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [tab, setTab] = useState<Tab>('overview')
  // 「服务」要问节点：第一次打开时才请求（m2-22 design 第 5 条）
  const [servicesOpened, setServicesOpened] = useState(false)
  const openTab = (v: string) => {
    setTab(v as Tab)
    if (v === 'services') setServicesOpened(true)
  }
  const [targets, setTargets] = useState<Record<FormTab, Target>>({ connections: EMPTY_TARGET, limit: EMPTY_TARGET, kick: EMPTY_TARGET })
  // 推送只补实时网速，其它字段照旧来自 server get（m2-14 design 第 3 条）。
  const feed = useDashboardFeed()
  const pick = (next: FormTab, row: TrafficTotal) => {
    setTargets((prev) => ({ ...prev, [next]: { inbound: row.inbound, credential: row.credential, seq: prev[next].seq + 1 } }))
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
      <Tabs value={tab} onValueChange={openTab}>
        {/* 标签页有十二个：标签栏允许换行（m2-16 design 第 7 条） */}
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="overview">{t('detail.tabs.overview')}</TabsTrigger>
          <TabsTrigger value="credentials">{t('detail.tabs.credentials')}</TabsTrigger>
          <TabsTrigger value="traffic">{t('detail.tabs.traffic')}</TabsTrigger>
          <TabsTrigger value="connections">{t('detail.tabs.connections')}</TabsTrigger>
          <TabsTrigger value="limit">{t('detail.tabs.limit')}</TabsTrigger>
          <TabsTrigger value="kick">{t('detail.tabs.kick')}</TabsTrigger>
          <TabsTrigger value="system">{t('detail.tabs.system')}</TabsTrigger>
          <TabsTrigger value="logs">{t('detail.tabs.logs')}</TabsTrigger>
          <TabsTrigger value="config">{t('detail.tabs.config')}</TabsTrigger>
          <TabsTrigger value="services">{t('detail.tabs.services')}</TabsTrigger>
          <TabsTrigger value="edit">{t('detail.tabs.edit')}</TabsTrigger>
          <TabsTrigger value="maintenance">{t('detail.tabs.maintenance')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="grid gap-4">
          <Overview name={name} feed={feed} />
          <Install name={name} />
        </TabsContent>
        {/* 凭据页不保留挂载：切走就卸载，原文跟着消失（m2-08 design 第 3 条） */}
        <TabsContent value="credentials">
          <Credentials name={name} />
        </TabsContent>
        <TabsContent value="traffic">
          <Traffic name={name} onPick={pick} />
        </TabsContent>
        {/* 连接、限速、踢线三页切走后仍然挂着（只是隐藏），表单与结果留在页面上，回来时也不会重新问节点 */}
        <TabsContent value="connections" forceMount hidden={tab !== 'connections'}>
          <Connections key={targets.connections.seq} name={name} initial={targets.connections} />
        </TabsContent>
        <TabsContent value="limit" forceMount hidden={tab !== 'limit'}>
          <Limit key={targets.limit.seq} name={name} initial={targets.limit} />
        </TabsContent>
        <TabsContent value="kick" forceMount hidden={tab !== 'kick'}>
          <Kick key={targets.kick.seq} name={name} initial={targets.kick} />
        </TabsContent>
        {/* 系统与日志两页要问节点，点了才请求；保留挂载，结果留在页面上（m2-14 design 第 4 条） */}
        <TabsContent value="system" forceMount hidden={tab !== 'system'}>
          <SystemTab name={name} />
        </TabsContent>
        <TabsContent value="logs" forceMount hidden={tab !== 'logs'}>
          <LogsTab name={name} />
        </TabsContent>
        {/* 节点配置要问节点，点了才请求；编辑页的预演结果与删除后的恢复入口要留着：都保留挂载（m2-16 design 第 5、6 条） */}
        <TabsContent value="config" forceMount hidden={tab !== 'config'}>
          <ConfigTab name={name} />
        </TabsContent>
        {/* 服务页保留挂载：nginx 的安装与卸载是长任务，切走再回来进度与结果还在 */}
        <TabsContent value="services" forceMount hidden={tab !== 'services'}>
          <ServicesTab name={name} enabled={servicesOpened} />
        </TabsContent>
        <TabsContent value="edit" forceMount hidden={tab !== 'edit'}>
          <EditTab name={name} />
        </TabsContent>
        {/* 维护页也保留挂载：升级是长任务，切走再回来进度与结果还在（m2-10 design 第 1 条） */}
        <TabsContent value="maintenance" forceMount hidden={tab !== 'maintenance'}>
          <Maintenance name={name} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Overview({ name, feed }: { name: string; feed: DashboardFeed }) {
  const { t } = useTranslation('servers')
  const server = useQuery(serverQuery(name))
  // 推送不在时才请求 server speed：读的是主控内存，不问节点，同样每 10 秒刷新。断开后在它的新结果回来之前，
  // 继续用最后一帧里这台服务器的值，不会闪回推送之前的旧值。
  const speed = useQuery({
    queryKey: ['server speed', name],
    queryFn: () => run<SpeedView>('server speed', { args: [name] }),
    refetchInterval: REFRESH_MS,
    enabled: !feed.live,
  })
  const fromFrame = feed.frame?.servers.find((s) => s.name === name)
  const pushed = fromFrame && (feed.live || feed.receivedAt > speed.dataUpdatedAt) ? fromFrame : undefined
  const up = pushed ? pushed.current_upload_speed : speed.data?.upload_speed
  const down = pushed ? pushed.current_download_speed : speed.data?.download_speed
  const none = t('fields.none')
  const s = server.data?.status
  const spec = server.data?.spec
  const port = (v: number | undefined, fallback: number) => (v ? String(v) : t('fields.defaultPort', { port: fallback }))
  // websocket 模式下节点不开任何端口，寻址那一组用不上，不显示（与添加对话框一致）。
  // 只有 auto 会降级为轮询；最近一次轮询对 auto 与 pull 都有意义（pull 本来就一直在轮询）。
  const addressed = spec !== undefined && spec.connection_mode !== 'websocket'
  const auto = spec?.connection_mode === 'auto'
  const polling = auto || spec?.connection_mode === 'pull'
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
              [t('fields.sameHost'), s.same_host_as_master ? t('fields.sameHostYes') : t('fields.sameHostNo')],
              [
                t('fields.speed'),
                <span className="tabular-nums" data-testid="overview-speed">
                  {up === undefined || down === undefined ? none : t('fields.speedValue', { up: formatSpeed(up), down: formatSpeed(down) })}
                </span>,
              ],
              ...(addressed
                ? ([
                    [t('add.fields.domain'), <span className="font-mono">{spec?.domain || none}</span>],
                    [t('add.fields.domain-v6'), <span className="font-mono">{spec?.domain_v6 || none}</span>],
                    [t('add.fields.listen-port'), port(spec?.listen_port, DEFAULT_PORTS.listen)],
                    [t('add.fields.pull-address'), <span className="font-mono">{spec?.pull_address || none}</span>],
                    [t('add.fields.pull-address-v6'), <span className="font-mono">{spec?.pull_address_v6 || none}</span>],
                    [t('add.fields.pull-port'), port(spec?.pull_port, DEFAULT_PORTS.pull)],
                  ] as [string, ReactNode][])
                : []),
              ...(auto
                ? ([[t('fields.fallback'), s.fallback_to_pull ? t('fields.fallbackYes', { time: s.fallback_at ? formatTime(s.fallback_at) : none }) : t('fields.fallbackNo')]] as [string, ReactNode][])
                : []),
              ...(polling ? ([[t('fields.lastPullAt'), s.last_pull_at ? formatTime(s.last_pull_at) : none]] as [string, ReactNode][]) : []),
            ]}
          />
        )}
      </CardContent>
    </Card>
  )
}

// TOKEN_SCOPES 是轮换与吊销的范围；值是命令的 which（m2-06：all、token、agent、pull）。
const TOKEN_SCOPES = ['all', 'token', 'agent', 'pull'] as const
type TokenScope = (typeof TOKEN_SCOPES)[number]

interface TokenView {
  server: string
  token: string
  agent_token: string
  pull_token: string
}

const TOKEN_FIELDS = ['token', 'agent_token', 'pull_token'] as const

// Credentials 是凭据页（m2-08 design 第 3–5 条）：状态来自 server get；原文照安装命令的写法，点了才取、不缓存、
// 不进 HTTP 缓存；轮换与吊销都是危险类「权限」，确认值是服务器名，成功后让概况与原文的查询失效。
function Credentials({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const server = useQuery(serverQuery(name))
  const [requested, setRequested] = useState(false)
  const [scope, setScope] = useState<TokenScope>('all')
  const tokens = useQuery({
    queryKey: ['server token show', name],
    queryFn: () => run<TokenView>('server token show', { args: [name], noStore: true }),
    enabled: requested,
    gcTime: 0,
  })
  const change = useMutation({
    // 命令名要写成字面量：构建时的清单扫描只认静态字符串
    mutationFn: (action: 'rotate' | 'revoke') => {
      const opts = { args: [name], flags: { which: scope }, confirm: name }
      return action === 'rotate' ? run<ServerObject>('server token rotate', opts) : run<ServerObject>('server token revoke', opts)
    },
    onSuccess: async (_res, action) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['server get', name] }), queryClient.invalidateQueries({ queryKey: ['server token show', name] })])
      toast.success(t(action === 'rotate' ? 'credentials.rotated' : 'credentials.revoked'))
    },
  })
  const onChange = async (action: 'rotate' | 'revoke') => {
    const scopeLabel = t(`credentials.scopes.${scope}`)
    const ok = await dialogs.confirm({
      title: t(action === 'rotate' ? 'credentials.rotateConfirmTitle' : 'credentials.revokeConfirmTitle', { name, scope: scopeLabel }),
      description: t(action === 'rotate' ? 'credentials.rotateConfirmDescription' : 'credentials.revokeConfirmDescription'),
      value: name,
      destructive: true,
    })
    if (ok) change.mutate(action)
  }
  const copy = async (text: string) => {
    if (await copyText(text)) toast.success(t('actions.copied', { ns: 'common' }))
    else toast.error(t('actions.copyFailed', { ns: 'common' }))
  }
  const s = server.data?.status
  const yesNo = (v: boolean | undefined) => (v ? t('credentials.yes') : t('credentials.no'))
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('credentials.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ErrorNotice error={server.error} />
        {s && (
          <Fields
            rows={[
              [t('credentials.rotationPending'), yesNo(s.rotation_pending)],
              [t('credentials.revokePending'), yesNo(s.revoke_pending)],
              [t('credentials.lastRotatedAt'), s.last_rotated_at ? formatTime(s.last_rotated_at) : t('fields.none')],
            ]}
          />
        )}
        <div className="grid gap-2">
          <div>
            <Button variant="outline" disabled={tokens.isFetching} onClick={() => (requested ? void tokens.refetch() : setRequested(true))}>
              {t('credentials.show')}
            </Button>
          </div>
          <p className="text-muted-foreground text-sm">{t('credentials.showHint')}</p>
          <ErrorNotice error={tokens.error} />
          {requested && tokens.data && !tokens.error && (
            <dl className="grid gap-2 text-sm" data-testid="token-values">
              {TOKEN_FIELDS.map((f) => (
                <div key={f} className="grid gap-1">
                  <dt className="text-muted-foreground font-mono">{f}</dt>
                  <dd className="flex items-center gap-2">
                    <code className="bg-muted rounded px-2 py-1 font-mono text-xs break-all" data-testid={`token-${f}`}>
                      {tokens.data[f]}
                    </code>
                    <Button size="sm" variant="outline" aria-label={t('credentials.copy', { field: f })} onClick={() => void copy(tokens.data[f])}>
                      {t('actions.copy', { ns: 'common' })}
                    </Button>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="token-scope">{t('credentials.scope')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as TokenScope)}>
              <SelectTrigger id="token-scope" aria-label={t('credentials.scope')} className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOKEN_SCOPES.map((sc) => (
                  <SelectItem key={sc} value={sc}>
                    {t(`credentials.scopes.${sc}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={change.isPending} onClick={() => void onChange('rotate')}>
              {t('credentials.rotate')}
            </Button>
            <Button variant="destructive" disabled={change.isPending} onClick={() => void onChange('revoke')}>
              {t('credentials.revoke')}
            </Button>
          </div>
          <ErrorNotice error={change.error} />
        </div>
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
    queryFn: () => run<InstallCommand>('server install-command', { args: [name], noStore: true }),
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

function Traffic({ name, onPick }: { name: string; onPick: (tab: FormTab, row: TrafficTotal) => void }) {
  const { t } = useTranslation('servers')
  const traffic = useQuery({
    queryKey: ['server traffic', name],
    queryFn: () => run<TrafficView>('server traffic', { args: [name] }),
    refetchInterval: REFRESH_MS,
  })
  const v = traffic.data
  const rows = v?.traffic ?? []
  return (
    <div className="grid gap-4">
      {v && <TrafficStats name={name} view={v} />}
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
    </div>
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
    // seq 在 key 里：每次从流量行点「连接」都是一次新查询，不会显示上一次留下的旧清单
    queryKey: ['server connections', name, initial.seq, applied?.inbound, applied?.credential],
    queryFn: ({ pageParam }) =>
      run<Page<Connection>>('server connections', { args: [name], flags: { inbound: applied?.inbound, credential: applied?.credential }, limit: 100, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: applied !== null,
    staleTime: Infinity, // 每页都要问节点：只在「查询」「刷新」「加载更多」时请求，挂载、重连时不自动重新请求
    gcTime: 0, // 换一组入站与凭据后旧的那份立刻丢掉：换回来时一定重新查，不会显示几分钟前的旧清单
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
        {restart.isPending ? t('restart.pending') : t('restart.button')}
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
