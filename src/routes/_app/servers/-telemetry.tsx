import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ApiError, run } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerObject } from '@/components/ServerStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatBytes, formatTime } from '@/lib/format'

import { Fields, serverQuery } from './-shared'

// 详情页的「系统」与「日志」两个标签页（m2-14 design 第 4 条）：都要经通道问节点，所以只在点击时请求，
// 结果留在页面上（两页保留挂载），切走再回来不重新问。

interface SystemInfo {
  hostname: string
  os: string
  kernel: string
  arch: string
  uptime_seconds: number
  cpu_model: string
  cpu_cores: number
  cpu_threads: number
  cpu_pct: number
  load1: number
  load5: number
  load15: number
  mem_total_bytes: number
  mem_used_bytes: number
  disk_total_bytes: number
  disk_used_bytes: number
  tcp_fast_open_server: boolean
  agent_version: string
  in_docker: boolean
  collected_at: string
}

interface NicAddr {
  ip: string
  family: string
  cidr: string
  scope: string
}

interface NicsView {
  nics: { name: string; addrs: NicAddr[] }[]
}

interface LogEntry {
  time?: string
  level?: string
  msg?: string
  attrs?: Record<string, string>
  raw?: string
}

interface LogFile {
  name: string
  size: number
  modified: string
  active: boolean
}

// SystemTab：「读取」同时请求 server system-info 与 server nics，再点一次两个都重新请求（seq 在 key 里）。
export function SystemTab({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [seq, setSeq] = useState(0)
  const common = { enabled: seq > 0, staleTime: Infinity, gcTime: 0 }
  const info = useQuery({
    queryKey: ['server system-info', name, seq],
    queryFn: () => run<SystemInfo>('server system-info', { args: [name] }),
    ...common,
  })
  const nics = useQuery({
    queryKey: ['server nics', name, seq],
    queryFn: () => run<NicsView>('server nics', { args: [name] }),
    ...common,
  })
  const i = info.data
  const yesNo = (v: boolean) => (v ? t('system.yes') : t('system.no'))
  const usage = (used: number, total: number) => t('system.usage', { used: formatBytes(used), total: formatBytes(total) })
  return (
    <div className="grid gap-4">
      <Card className="shadow-flat">
        <CardHeader>
          <CardTitle>{t('system.title')}</CardTitle>
          <CardDescription>{t('system.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div>
            <Button variant="outline" disabled={info.isFetching || nics.isFetching} onClick={() => setSeq((n) => n + 1)}>
              {t('system.read')}
            </Button>
          </div>
          <ErrorNotice error={info.error} />
          {i && !info.error && (
            <div data-testid="system-info">
              <Fields
                rows={[
                  [t('system.hostname'), <span className="font-mono">{i.hostname}</span>],
                  [t('system.os'), i.os],
                  [t('system.kernel'), i.kernel],
                  [t('system.arch'), i.arch],
                  [t('system.uptime'), uptime(t, i.uptime_seconds)],
                  [
                    t('system.cpu'),
                    t('system.cpuValue', {
                      model: i.cpu_model,
                      cores: i.cpu_cores,
                      threads: i.cpu_threads,
                    }),
                  ],
                  [t('system.cpuPct'), `${i.cpu_pct.toFixed(1)}%`],
                  [t('system.load'), `${i.load1.toFixed(2)} / ${i.load5.toFixed(2)} / ${i.load15.toFixed(2)}`],
                  [t('system.memory'), usage(i.mem_used_bytes, i.mem_total_bytes)],
                  [t('system.disk'), usage(i.disk_used_bytes, i.disk_total_bytes)],
                  [t('system.tfo'), yesNo(i.tcp_fast_open_server)],
                  [t('system.agentVersion'), <span className="font-mono">{i.agent_version}</span>],
                  [t('system.inDocker'), yesNo(i.in_docker)],
                  [t('system.collectedAt'), formatTime(i.collected_at)],
                ]}
              />
            </div>
          )}
        </CardContent>
      </Card>
      <Card className="shadow-flat">
        <CardHeader>
          <CardTitle>{t('system.nics')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ErrorNotice error={nics.error} />
          {nics.data && !nics.error && (
            <Table data-testid="nics">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('system.nicName')}</TableHead>
                  <TableHead>{t('system.addresses')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nics.data.nics.map((n) => (
                  <TableRow key={n.name} data-testid={`nic-${n.name}`}>
                    <TableCell className="font-mono align-top">{n.name}</TableCell>
                    <TableCell className="grid gap-1">
                      {n.addrs.map((a) => (
                        <span key={a.ip} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono">{a.cidr || a.ip}</span>
                          <Badge variant="outline">{a.family}</Badge>
                          <Badge variant="secondary">{t(`system.scopes.${a.scope}` as 'system.scopes.global', { defaultValue: a.scope })}</Badge>
                        </span>
                      ))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function uptime(t: (key: 'system.uptimeValue', opts: Record<string, number>) => string, seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return t('system.uptimeValue', { d, h, m })
}

const SERVICES = ['agent', 'core', 'nginx'] as const
type Service = (typeof SERVICES)[number]
const LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

interface LogQuery {
  service: Service
  level: Level
  grep: string
  file: string
  seq: number
}

// LogsTab：条件改了要点「查询」才生效；每次「查询」seq 加一，保证是一次新的查询（照连接清单的写法）。
// 「日志文件」点了才列出；点一个文件就按它查询，来源是 nginx 时改成 agent（nginx 不能带文件）。只读，没有删除或清空。
export function LogsTab({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const [service, setService] = useState<Service>('agent')
  const [level, setLevel] = useState<Level>('all')
  const [grep, setGrep] = useState('')
  const [file, setFile] = useState('')
  const [applied, setApplied] = useState<LogQuery | null>(null)
  const [filesSeq, setFilesSeq] = useState(0)
  const logs = useInfiniteQuery({
    queryKey: ['server logs list', name, applied],
    queryFn: ({ pageParam }) =>
      run<Page<LogEntry>>('server logs list', {
        args: [name],
        flags: {
          service: applied?.service,
          level: applied?.level === 'all' ? undefined : applied?.level,
          grep: applied?.grep || undefined,
          file: applied?.file || undefined,
        },
        limit: 100,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled: applied !== null,
    staleTime: Infinity,
    gcTime: 0,
  })
  const files = useQuery({
    queryKey: ['server logs files', name, filesSeq],
    queryFn: () => run<Page<LogFile>>('server logs files', { args: [name], limit: 100 }),
    enabled: filesSeq > 0,
    staleTime: Infinity,
    gcTime: 0,
  })
  const apply = (next: Omit<LogQuery, 'seq'>) => setApplied((prev) => ({ ...next, seq: (prev?.seq ?? 0) + 1 }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    apply({ service, level, grep, file })
  }
  const pickFile = (f: string) => {
    const s = service === 'nginx' ? 'agent' : service
    setService(s)
    setFile(f)
    apply({ service: s, level, grep, file: f })
  }
  const items = logs.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <div className="grid gap-4">
      <Card className="shadow-flat">
        <CardHeader>
          <CardDescription>{t('logs.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <form className="grid gap-3" onSubmit={submit}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="logs-service">{t('logs.service')}</Label>
                <Select
                  value={service}
                  onValueChange={(v) => {
                    setService(v as Service)
                    if (v === 'nginx') setFile('')
                  }}
                >
                  <SelectTrigger id="logs-service" aria-label={t('logs.service')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`logs.services.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="logs-level">{t('logs.level')}</Label>
                <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
                  <SelectTrigger id="logs-level" aria-label={t('logs.level')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {t(`logs.levels.${l}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="logs-grep">{t('logs.grep')}</Label>
                <Input id="logs-grep" value={grep} onChange={(e) => setGrep(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="logs-file">{t('logs.file')}</Label>
                <div className="flex gap-2">
                  <Input id="logs-file" readOnly value={file} placeholder={service === 'nginx' ? t('logs.noFileForNginx') : t('logs.fileHint')} />
                  {file && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setFile('')}>
                      {t('logs.clearFile')}
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={logs.isFetching}>
                {t('logs.search')}
              </Button>
              <Button type="button" variant="outline" disabled={files.isFetching} onClick={() => setFilesSeq((n) => n + 1)}>
                {t('logs.files')}
              </Button>
            </div>
          </form>
          <ErrorNotice error={files.error} />
          {files.data && !files.error && (
            <Table data-testid="log-files">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('logs.fileName')}</TableHead>
                  <TableHead className="text-right">{t('logs.fileSize')}</TableHead>
                  <TableHead>{t('logs.fileModified')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.data.items.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell>
                      <Button variant="link" className="h-auto p-0 font-mono" onClick={() => pickFile(f.name)}>
                        {f.name}
                      </Button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(f.size)}</TableCell>
                    <TableCell>{formatTime(f.modified)}</TableCell>
                    <TableCell>{f.active && <Badge variant="secondary">{t('logs.active')}</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <ErrorNotice error={logs.error} />
          {applied && logs.isSuccess && items.length === 0 && <p className="text-muted-foreground text-sm">{t('logs.empty')}</p>}
          {items.length > 0 && (
            <div className="bg-muted grid max-h-[32rem] gap-0.5 overflow-auto rounded-md p-3 font-mono text-xs" data-testid="log-lines">
              {items.map((l, i) => (
                <LogLine key={i} entry={l} />
              ))}
            </div>
          )}
          {logs.hasNextPage && (
            <Button variant="outline" className="justify-self-center" onClick={() => void logs.fetchNextPage()}>
              {t('logs.loadMore')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// LogLine 显示一行：时间、级别、内容与附加字段；解析不了的行只有原文。
function LogLine({ entry: l }: { entry: LogEntry }) {
  if (!l.msg && l.raw) return <p className="break-all whitespace-pre-wrap">{l.raw}</p>
  const attrs = Object.entries(l.attrs ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' ')
  return (
    <p className="break-all whitespace-pre-wrap">
      {l.time && <span className="text-muted-foreground">{l.time} </span>}
      {l.level && <span className="font-semibold">{l.level.toUpperCase()} </span>}
      <span>{l.msg}</span>
      {attrs && <span className="text-muted-foreground"> {attrs}</span>}
    </p>
  )
}

// TrafficStatsView 是 server traffic 里流量统计口径的那几项（m2-11）。
export interface TrafficStatsView {
  traffic_stats_mode?: string
  traffic_source?: string
  include_in_traffic_stats?: boolean
  system_rx_cycle?: number
  system_tx_cycle?: number
  system_traffic_updated_at?: string | null
}

const MODES = ['both', 'upload', 'download', 'max'] as const
const SOURCES = ['core', 'system'] as const

// TrafficStats 是流量页顶部的统计口径（m2-14 design 第 5 条）。当前值与 resourceVersion 都取自 server get 的同一份数据，
// 乐观并发才起作用（审查补充：当前值若取自另一条各自刷新的 server traffic，会悄悄覆盖别人刚改的值）；server traffic 只用来
// 显示物理网卡的周期累计。口径变了（自己或别人改的）就按新值重置表单，没变时没保存的选择留着。
export function TrafficStats({ name, view }: { name: string; view: TrafficStatsView }) {
  const server = useQuery(serverQuery(name))
  if (!server.data) return null
  const spec = server.data.spec
  return <TrafficStatsForm key={`${spec.traffic_stats_mode}|${spec.traffic_source}|${spec.include_in_traffic_stats}`} name={name} view={view} server={server.data} />
}

// TrafficStatsForm 保存时只带改过的项，加上同一份 server get 的 resourceVersion；version_conflict 时提示重新读取，不自动覆盖。
function TrafficStatsForm({ name, view: v, server }: { name: string; view: TrafficStatsView; server: ServerObject }) {
  const { t } = useTranslation('servers')
  const queryClient = useQueryClient()
  // 没有这几个字段时按主控的默认值（mode both、source system、include true）
  const current = {
    mode: server.spec.traffic_stats_mode ?? 'both',
    source: server.spec.traffic_source ?? 'system',
    include: server.spec.include_in_traffic_stats ?? true,
  }
  const [mode, setMode] = useState(current.mode)
  const [source, setSource] = useState(current.source)
  const [include, setInclude] = useState(current.include)
  const changed = mode !== current.mode || source !== current.source || include !== current.include
  const save = useMutation({
    mutationFn: () =>
      run('server traffic-stats set', {
        args: [name],
        flags: {
          'resource-version': server.metadata.resourceVersion,
          mode: mode !== current.mode ? mode : undefined,
          source: source !== current.source ? source : undefined,
          include: include !== current.include ? String(include) : undefined,
        },
      }),
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['server get', name] }), queryClient.invalidateQueries({ queryKey: ['server traffic', name] })])
      toast.success(t('trafficStats.saved'))
    },
  })
  const reload = async () => {
    await Promise.all([queryClient.refetchQueries({ queryKey: ['server get', name] }), queryClient.refetchQueries({ queryKey: ['server traffic', name] })])
    save.reset()
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }
  const conflict = save.error instanceof ApiError && save.error.code === 'version_conflict'
  return (
    <Card className="shadow-flat" data-testid="traffic-stats">
      <CardHeader>
        <CardTitle>{t('trafficStats.title')}</CardTitle>
        <CardDescription>{t('trafficStats.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Fields
          rows={[
            [t('trafficStats.mode'), t(`trafficStats.modes.${current.mode}` as 'trafficStats.modes.both', { defaultValue: current.mode })],
            [t('trafficStats.source'), t(`trafficStats.sources.${current.source}` as 'trafficStats.sources.core', { defaultValue: current.source })],
            [t('trafficStats.include'), current.include ? t('system.yes') : t('system.no')],
            ...(current.source === 'system'
              ? ([
                  [
                    t('trafficStats.systemCycle'),
                    t('trafficStats.systemCycleValue', {
                      rx: formatBytes(v.system_rx_cycle ?? 0),
                      tx: formatBytes(v.system_tx_cycle ?? 0),
                    }),
                  ],
                  [t('trafficStats.systemUpdatedAt'), v.system_traffic_updated_at ? formatTime(v.system_traffic_updated_at) : t('fields.none')],
                ] as [string, string][])
              : []),
          ]}
        />
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor="traffic-mode">{t('trafficStats.mode')}</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger id="traffic-mode" aria-label={t('trafficStats.mode')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {t(`trafficStats.modes.${m}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="traffic-source">{t('trafficStats.source')}</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="traffic-source" aria-label={t('trafficStats.source')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`trafficStats.sources.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 self-end text-sm">
              <Switch checked={include} onCheckedChange={setInclude} aria-label={t('trafficStats.include')} />
              {t('trafficStats.include')}
            </label>
          </div>
          <ErrorNotice error={save.error} />
          {conflict && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('trafficStats.conflict')}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
                  {t('actions.refresh', { ns: 'common' })}
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Button type="submit" disabled={!changed || save.isPending}>
              {t('trafficStats.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
