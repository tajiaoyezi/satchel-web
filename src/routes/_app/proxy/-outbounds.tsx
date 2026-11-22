import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run, type FlagValue } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WideDialog } from '@/components/WideDialog'
import { formatTime } from '@/lib/format'

import { PlanReview, type PlanView } from '../-plan'
import { Fields } from '../servers/-shared'
import type { InboundView } from './-inbounds'
import {
  EMPTY_TARGETS,
  Field,
  hasTargets,
  isMasked,
  JsonField,
  jsonText,
  LocalError,
  MaskedValue,
  parseObject,
  ServerPicker,
  serverName,
  TargetServers,
  targetFlags,
  useObjectOp,
  useProxyRefresh,
  useServers,
} from './-shared'

// 代理页的「出站」（web-console「代理页」，m2-18 design 第 6 到 10 条）：列表、探测、新建与编辑、删除与恢复、落地规划、批量新建。

interface OutboundSpec {
  server_id: number
  tag: string
  protocol: string
  settings: unknown
  is_warp: boolean
  balancer_group: string
  probe: unknown
}

interface OutboundStatus {
  last_probe_ok: boolean
  last_probe_latency_ms: number | null
  last_probed_at: string | null
}

interface OutboundView {
  metadata: { id: number; resourceVersion: number; deletedAt?: string | null }
  spec: OutboundSpec
  status: OutboundStatus
  server_name?: string
}

interface ProbeResult {
  id: number
  server: string
  tag: string
  url: string
  ok: boolean
  latency_ms: number
  status_code: number
  error?: string
  probed_at: string
}

export function OutboundsTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('proxy')
  const refresh = useProxyRefresh()
  const op = useObjectOp(refresh)
  const [draft, setDraft] = useState('')
  const [group, setGroup] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [probing, setProbing] = useState<OutboundView | null>(null)
  const [dialog, setDialog] = useState<'create' | 'landing' | 'batch' | null>(null)
  const name = server?.name ?? ''
  const list = useInfiniteQuery({
    queryKey: ['outbound list', name, group, includeDeleted],
    queryFn: ({ pageParam }) =>
      run<Page<OutboundView>>('outbound list', {
        flags: { 'server-name': name || undefined, 'balancer-group': group || undefined, 'include-deleted': includeDeleted || undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const search = (e: FormEvent) => {
    e.preventDefault()
    setGroup(draft.trim())
  }
  const close = () => setDialog(null)
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('outbounds.description')}</CardDescription>
        <div className="flex flex-wrap items-end gap-2">
          <form className="flex items-end gap-2" onSubmit={search}>
            <Field id="outbound-group" label={t('outbounds.groupFilter')}>
              <Input id="outbound-group" className="w-40" value={draft} onChange={(e) => setDraft(e.target.value)} />
            </Field>
            <Button type="submit" variant="outline">
              {t('search')}
            </Button>
          </form>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={includeDeleted} onCheckedChange={setIncludeDeleted} aria-label={t('includeDeleted')} />
            {t('includeDeleted')}
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={() => setDialog('create')}>{t('outbounds.create')}</Button>
            <Button variant="outline" onClick={() => setDialog('landing')}>
              {t('outbounds.landing')}
            </Button>
            <Button variant="outline" onClick={() => setDialog('batch')}>
              {t('outbounds.batch')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cols.id')}</TableHead>
              <TableHead>{t('cols.server')}</TableHead>
              <TableHead>{t('cols.tag')}</TableHead>
              <TableHead>{t('cols.protocol')}</TableHead>
              <TableHead>{t('cols.group')}</TableHead>
              <TableHead>{t('cols.probe')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  {t('outbounds.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((ob) => {
              const deleted = !!ob.metadata.deletedAt
              const target = { kind: 'Outbound' as const, id: ob.metadata.id, resourceVersion: ob.metadata.resourceVersion, label: ob.spec.tag }
              return (
                <TableRow key={ob.metadata.id} data-testid={`outbound-row-${ob.metadata.id}`}>
                  <TableCell className="font-mono">{ob.metadata.id}</TableCell>
                  <TableCell>{ob.server_name ?? ob.spec.server_id}</TableCell>
                  <TableCell className="font-mono">{ob.spec.tag}</TableCell>
                  <TableCell>{ob.spec.protocol}</TableCell>
                  <TableCell>{ob.spec.balancer_group || t('none')}</TableCell>
                  <TableCell>{deleted ? <Badge variant="destructive">{t('deleted')}</Badge> : <ProbeStatus s={ob.status} />}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {deleted ? (
                      <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'restore' })}>
                        {t('op.restore')}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setProbing(ob)}>
                          {t('outbounds.probe')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setViewing(ob.metadata.id)}>
                          {t('view')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'delete' })}>
                          {t('op.delete')}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
      {viewing !== null && <OutboundDialog id={viewing} onClose={() => setViewing(null)} onApplied={refresh} />}
      {probing && <ProbeDialog outbound={probing} onClose={() => setProbing(null)} />}
      {dialog === 'create' && <NewOutboundDialog initialServer={server?.id ?? null} onClose={close} onApplied={refresh} />}
      {dialog === 'landing' && <LandingDialog initialServer={server?.id ?? null} onClose={close} onApplied={refresh} />}
      {dialog === 'batch' && <OutboundBatchDialog onClose={close} onApplied={refresh} />}
      {op.dialog}
    </Card>
  )
}

function ProbeStatus({ s }: { s: OutboundStatus }) {
  const { t } = useTranslation('proxy')
  if (!s.last_probed_at) return <span className="text-muted-foreground">{t('outbounds.neverProbed')}</span>
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      <Badge variant={s.last_probe_ok ? 'default' : 'destructive'}>{s.last_probe_ok ? t('outbounds.ok') : t('outbounds.fail')}</Badge>
      {s.last_probe_latency_ms !== null && <span className="tabular-nums">{t('outbounds.latency', { ms: s.last_probe_latency_ms })}</span>}
      <span className="text-muted-foreground">{formatTime(s.last_probed_at)}</span>
    </span>
  )
}

// ProbeDialog：探测地址留空用主控的默认，超时发成「10s」这样的时长；成功或失败后列表都重新读取探测状态（design 第 8 条）。
function ProbeDialog({ outbound, onClose }: { outbound: OutboundView; onClose: () => void }) {
  const { t } = useTranslation('proxy')
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [seconds, setSeconds] = useState('10')
  const probe = useMutation({
    mutationFn: () => run<ProbeResult>('outbound probe', { args: [String(outbound.metadata.id)], flags: { url: url.trim() || undefined, timeout: `${Number(seconds) || 10}s` } }),
    onSettled: () => Promise.all([queryClient.invalidateQueries({ queryKey: ['outbound list'] }), queryClient.invalidateQueries({ queryKey: ['outbound get', outbound.metadata.id] })]),
  })
  const r = probe.data
  const submit = (e: FormEvent) => {
    e.preventDefault()
    probe.mutate()
  }
  return (
    <WideDialog title={t('outbounds.probeTitle', { tag: outbound.spec.tag, server: outbound.server_name ?? outbound.spec.server_id })} description={t('outbounds.probeDescription')} onClose={onClose}>
      <form className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" onSubmit={submit}>
        <Field id="probe-url" label={t('outbounds.probeUrl')}>
          <Input id="probe-url" value={url} placeholder={t('outbounds.probeUrlPlaceholder')} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field id="probe-timeout" label={t('outbounds.probeTimeout')}>
          <Input id="probe-timeout" type="number" min={1} max={30} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
        </Field>
        <Button type="submit" disabled={probe.isPending}>
          {t('outbounds.probe')}
        </Button>
      </form>
      <ErrorNotice error={probe.error} />
      {r && (
        <div data-testid="probe-result">
          <Fields
            rows={[
              [t('outbounds.result'), <Badge variant={r.ok ? 'default' : 'destructive'}>{r.ok ? t('outbounds.ok') : t('outbounds.fail')}</Badge>],
              [t('outbounds.probeUrl'), <span className="font-mono text-xs break-all">{r.url}</span>],
              [t('outbounds.statusCode'), r.status_code || t('none')],
              ...(r.ok || r.latency_ms > 0 ? [[t('outbounds.latencyLabel'), t('outbounds.latency', { ms: r.latency_ms })] as [string, ReactNode]] : []),
              ...(r.error ? [[t('outbounds.error'), <span className="break-all">{r.error}</span>] as [string, ReactNode]] : []),
              [t('outbounds.probedAt'), formatTime(r.probed_at)],
            ]}
          />
        </div>
      )}
    </WideDialog>
  )
}

function OutboundDialog({ id, onClose, onApplied }: { id: number; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const ob = useQuery({ queryKey: ['outbound get', id], queryFn: () => run<OutboundView>('outbound get', { args: [String(id)] }) })
  // 计划放在表单外面：提交会抬高版本、表单按新版本重新挂载，预演与提交的结果仍然留着
  const [plan, setPlan] = useState<PlanView | null>(null)
  const d = ob.data
  return (
    <WideDialog title={t('outbounds.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={ob.error} />
      {d && (
        <div className="grid gap-4" data-testid="outbound-detail">
          <Fields
            rows={[
              [t('cols.server'), d.server_name ?? d.spec.server_id],
              [t('fields.isWarp'), d.spec.is_warp ? t('yes') : t('no')],
              [t('cols.probe'), <ProbeStatus s={d.status} />],
              [t('fields.settings'), <MaskedValue v={d.spec.settings} />],
            ]}
          />
          <OutboundForm key={d.metadata.resourceVersion} outbound={d} onPlanned={setPlan} />
        </div>
      )}
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}

function NewOutboundDialog({ initialServer, onClose, onApplied }: { initialServer: number | null; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const [plan, setPlan] = useState<PlanView | null>(null)
  return (
    <WideDialog title={t('outbounds.createTitle')} onClose={onClose}>
      <OutboundForm initialServer={initialServer} onPlanned={setPlan} />
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}

// OutboundForm 新建或编辑一个出站（design 第 7 条）。编辑只发改过的字段；settings 打码时留空不发，填了就整体替换。
// 协议是文本框：出站没有协议矩阵，取值由主控判定。
function OutboundForm({ outbound, initialServer = null, onPlanned }: { outbound?: OutboundView; initialServer?: number | null; onPlanned: (p: PlanView) => void }) {
  const { t } = useTranslation('proxy')
  const s = outbound?.spec
  const [serverId, setServerId] = useState<number | null>(s?.server_id ?? initialServer)
  const [tag, setTag] = useState(s?.tag ?? '')
  const [protocol, setProtocol] = useState(s?.protocol ?? '')
  const [group, setGroup] = useState(s?.balancer_group ?? '')
  const [probe, setProbe] = useState(jsonText(s?.probe))
  const [settings, setSettings] = useState(jsonText(s?.settings))
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (op: object) => run<PlanView>('plan', { flags: { spec: JSON.stringify(op) } }), onSuccess: onPlanned })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const pp = parseObject(probe)
    const ps = parseObject(settings)
    if (!pp.ok) return setLocalError(t('json.badField', { field: 'probe' }))
    if (!ps.ok) return setLocalError(t('json.badField', { field: 'settings' }))
    if (!s) {
      const spec: Record<string, unknown> = { server_id: serverId, tag: tag.trim(), protocol: protocol.trim(), balancer_group: group.trim() }
      if (pp.value) spec.probe = pp.value
      if (ps.value) spec.settings = ps.value
      setLocalError('')
      return preview.mutate({ op: 'create', kind: 'Outbound', spec })
    }
    const changed: Record<string, unknown> = {}
    if (tag.trim() !== s.tag) changed.tag = tag.trim()
    if (protocol.trim() !== s.protocol) changed.protocol = protocol.trim()
    if (group.trim() !== (s.balancer_group ?? '')) changed.balancer_group = group.trim()
    if (pp.value !== undefined && JSON.stringify(pp.value) !== JSON.stringify(s.probe)) changed.probe = pp.value
    if (ps.value !== undefined && (isMasked(s.settings) || JSON.stringify(ps.value) !== JSON.stringify(s.settings))) changed.settings = ps.value
    if (Object.keys(changed).length === 0) return setLocalError(t('edit.noChange'))
    setLocalError('')
    preview.mutate({ op: 'update', kind: 'Outbound', id: outbound.metadata.id, resourceVersion: outbound.metadata.resourceVersion, spec: changed })
  }
  const canPreview = s ? true : serverId !== null && tag.trim() !== '' && protocol.trim() !== ''
  // 编辑时留空就不发这个字段：没打码的框写明要清空得填 {}（design 第 5、7 条）
  const settingsHint = s ? (isMasked(s.settings) ? t('json.maskedHint') : t('json.clearHint')) : undefined
  const probeHint = s ? `${t('outbounds.probeHint')} ${t('json.clearHint')}` : t('outbounds.probeHint')
  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={submit}>
      {s && <p className="text-sm font-medium">{t('edit.title')}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!s && (
          <Field id="ob-server" label={t('server.label')}>
            <ServerPicker id="ob-server" label={t('server.label')} value={serverId} onChange={setServerId} />
          </Field>
        )}
        <Field id="ob-tag" label={t('cols.tag')}>
          <Input id="ob-tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </Field>
        <Field id="ob-protocol" label={t('cols.protocol')} hint={t('outbounds.protocolHint')}>
          <Input id="ob-protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
        </Field>
        <Field id="ob-group" label={t('cols.group')}>
          <Input id="ob-group" value={group} onChange={(e) => setGroup(e.target.value)} />
        </Field>
      </div>
      <JsonField id="ob-settings" label={t('fields.settings')} hint={settingsHint} value={settings} onChange={setSettings} />
      <JsonField id="ob-probe" label={t('fields.probe')} hint={probeHint} value={probe} onChange={setProbe} />
      <LocalError message={localError} />
      <ErrorNotice error={preview.error} />
      <div>
        <Button type="submit" disabled={!canPreview || preview.isPending}>
          {t('preview')}
        </Button>
      </div>
    </form>
  )
}

type LandingSource = 'reference' | 'manual'

// inboundOptions 列一台服务器上的入站，给落地规划选作用范围与落地目标用（design 第 9 条）。
function useInboundOptions(name: string) {
  return useQuery({
    queryKey: ['inbound list', 'options', name],
    queryFn: () => run<Page<InboundView>>('inbound list', { flags: { 'server-name': name }, limit: 500 }),
    enabled: name !== '',
  }).data?.items
}

function InboundSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: InboundView[] | undefined }) {
  const { t } = useTranslation('proxy')
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label}>
        <SelectValue placeholder={t('landing.chooseInbound')} />
      </SelectTrigger>
      <SelectContent>
        {(options ?? []).map((ib) => (
          <SelectItem key={ib.metadata.id} value={ib.spec.tag}>
            {t('landing.inboundOption', { tag: ib.spec.tag, protocol: ib.spec.protocol, port: ib.spec.port })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// LandingDialog：outbound landing plan 生成「新建出站 + 新建路由规则」两条变更。落地目标二选一：引用另一台服务器的入站
// （主控派生出站配置），或手工填协议与 settings；只发当前选中那种来源的字段。
function LandingDialog({ initialServer, onClose, onApplied }: { initialServer: number | null; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const servers = useServers()
  const [sourceId, setSourceId] = useState<number | null>(initialServer)
  const [outboundTag, setOutboundTag] = useState('')
  const [scope, setScope] = useState<'server' | 'inbound'>('server')
  const [inboundTag, setInboundTag] = useState('')
  const [source, setSource] = useState<LandingSource>('reference')
  const [targetId, setTargetId] = useState<number | null>(null)
  const [targetInbound, setTargetInbound] = useState('')
  const [protocol, setProtocol] = useState('')
  const [settings, setSettings] = useState('')
  const [detour, setDetour] = useState('')
  const [group, setGroup] = useState('')
  const [sortOrder, setSortOrder] = useState('100')
  const [localError, setLocalError] = useState('')
  const sourceName = serverName(servers, sourceId)
  const targetName = serverName(servers, targetId)
  const sourceInbounds = useInboundOptions(scope === 'inbound' ? sourceName : '')
  const targetInbounds = useInboundOptions(source === 'reference' ? targetName : '')
  const preview = useMutation({ mutationFn: (flags: Record<string, FlagValue>) => run<PlanView>('outbound landing plan', { flags }) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const flags: Record<string, FlagValue> = { 'server-name': sourceName, 'outbound-tag': outboundTag.trim(), 'sort-order': Number(sortOrder || 100) }
    if (scope === 'inbound') flags['inbound-tag'] = inboundTag
    if (source === 'reference') {
      flags['target-server'] = targetName
      flags['target-inbound'] = targetInbound
    } else {
      flags.protocol = protocol.trim()
      const p = parseObject(settings)
      if (!p.ok) return setLocalError(t('json.badField', { field: 'settings' }))
      if (p.value) flags.settings = settings
    }
    if (detour.trim()) flags.detour = detour.trim()
    if (group.trim()) flags['balancer-group'] = group.trim()
    setLocalError('')
    preview.mutate(flags)
  }
  const canPreview =
    sourceId !== null &&
    outboundTag.trim() !== '' &&
    (scope === 'server' || inboundTag !== '') &&
    (source === 'reference' ? targetId !== null && targetInbound !== '' : protocol.trim() !== '')
  return (
    <WideDialog title={t('landing.title')} description={t('landing.description')} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="landing-source" label={t('landing.source')}>
            <ServerPicker
              id="landing-source"
              label={t('landing.source')}
              value={sourceId}
              onChange={(id) => {
                setSourceId(id)
                setInboundTag('')
              }}
            />
          </Field>
          <Field id="landing-tag" label={t('landing.outboundTag')}>
            <Input id="landing-tag" value={outboundTag} onChange={(e) => setOutboundTag(e.target.value)} />
          </Field>
          <Field id="landing-scope" label={t('landing.scope')}>
            <Select value={scope} onValueChange={(v) => setScope(v as 'server' | 'inbound')}>
              <SelectTrigger id="landing-scope" aria-label={t('landing.scope')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="server">{t('landing.scopes.server')}</SelectItem>
                <SelectItem value="inbound">{t('landing.scopes.inbound')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scope === 'inbound' && (
            <Field id="landing-inbound" label={t('landing.inboundTag')}>
              <InboundSelect id="landing-inbound" label={t('landing.inboundTag')} value={inboundTag} onChange={setInboundTag} options={sourceInbounds} />
            </Field>
          )}
        </div>
        <fieldset className="grid gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">{t('landing.target')}</legend>
          <Select value={source} onValueChange={(v) => setSource(v as LandingSource)}>
            <SelectTrigger aria-label={t('landing.targetKind')} className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reference">{t('landing.sources.reference')}</SelectItem>
              <SelectItem value="manual">{t('landing.sources.manual')}</SelectItem>
            </SelectContent>
          </Select>
          {source === 'reference' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="landing-target" label={t('landing.targetServer')}>
                <ServerPicker
                  id="landing-target"
                  label={t('landing.targetServer')}
                  value={targetId}
                  onChange={(id) => {
                    setTargetId(id)
                    setTargetInbound('')
                  }}
                />
              </Field>
              <Field id="landing-target-inbound" label={t('landing.targetInbound')}>
                <InboundSelect id="landing-target-inbound" label={t('landing.targetInbound')} value={targetInbound} onChange={setTargetInbound} options={targetInbounds} />
              </Field>
            </div>
          ) : (
            <div className="grid gap-3">
              <Field id="landing-protocol" label={t('cols.protocol')}>
                <Input id="landing-protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
              </Field>
              <JsonField id="landing-settings" label={t('fields.settings')} value={settings} onChange={setSettings} />
            </div>
          )}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="landing-detour" label={t('landing.detour')}>
            <Input id="landing-detour" value={detour} onChange={(e) => setDetour(e.target.value)} />
          </Field>
          <Field id="landing-group" label={t('cols.group')}>
            <Input id="landing-group" value={group} onChange={(e) => setGroup(e.target.value)} />
          </Field>
          <Field id="landing-sort" label={t('landing.sortOrder')}>
            <Input id="landing-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </Field>
        </div>
        <Alert>
          <AlertDescription>{t('landing.routingNote')}</AlertDescription>
        </Alert>
        <LocalError message={localError} />
        <ErrorNotice error={preview.error} />
        <div>
          <Button type="submit" disabled={!canPreview || preview.isPending}>
            {t('preview')}
          </Button>
        </div>
      </form>
      {preview.data && <PlanReview key={preview.data.plan_id} plan={preview.data} onApplied={onApplied} />}
    </WideDialog>
  )
}

// OutboundBatchDialog：目标服务器加出站参数，调 outbound batch plan 得到一份计划（design 第 10 条）。
function OutboundBatchDialog({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const [targets, setTargets] = useState(EMPTY_TARGETS)
  const [tag, setTag] = useState('')
  const [protocol, setProtocol] = useState('')
  const [settings, setSettings] = useState('')
  const [group, setGroup] = useState('')
  const [probe, setProbe] = useState('')
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (flags: Record<string, FlagValue>) => run<PlanView>('outbound batch plan', { flags }) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const ps = parseObject(settings)
    const pp = parseObject(probe)
    if (!ps.ok) return setLocalError(t('json.badField', { field: 'settings' }))
    if (!pp.ok) return setLocalError(t('json.badField', { field: 'probe' }))
    const flags: Record<string, FlagValue> = { ...targetFlags(targets), tag: tag.trim(), protocol: protocol.trim() }
    if (ps.value) flags.settings = settings
    if (pp.value) flags.probe = probe
    if (group.trim()) flags['balancer-group'] = group.trim()
    setLocalError('')
    preview.mutate(flags)
  }
  const canPreview = hasTargets(targets) && tag.trim() !== '' && protocol.trim() !== ''
  return (
    <WideDialog title={t('outbounds.batchTitle')} description={t('outbounds.batchDescription')} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <TargetServers value={targets} onChange={setTargets} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="ob-batch-tag" label={t('cols.tag')}>
            <Input id="ob-batch-tag" value={tag} onChange={(e) => setTag(e.target.value)} />
          </Field>
          <Field id="ob-batch-protocol" label={t('cols.protocol')}>
            <Input id="ob-batch-protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)} />
          </Field>
          <Field id="ob-batch-group" label={t('cols.group')}>
            <Input id="ob-batch-group" value={group} onChange={(e) => setGroup(e.target.value)} />
          </Field>
        </div>
        <JsonField id="ob-batch-settings" label={t('fields.settings')} value={settings} onChange={setSettings} />
        <JsonField id="ob-batch-probe" label={t('fields.probe')} hint={t('outbounds.probeHint')} value={probe} onChange={setProbe} />
        <LocalError message={localError} />
        <ErrorNotice error={preview.error} />
        <div>
          <Button type="submit" disabled={!canPreview || preview.isPending}>
            {t('preview')}
          </Button>
        </div>
      </form>
      {preview.data && <PlanReview key={preview.data.plan_id} plan={preview.data} onApplied={onApplied} />}
    </WideDialog>
  )
}
