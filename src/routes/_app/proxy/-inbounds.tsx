import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run, type FlagValue } from '@/api/client'
import type { Page } from '@/api/types'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WideDialog } from '@/components/WideDialog'

import { PlanReview, type PlanView } from '../-plan'
import { Fields } from '../servers/-shared'
import {
  CopyRows,
  EMPTY_TARGETS,
  Field,
  hasTargets,
  isMasked,
  JsonField,
  jsonText,
  LocalError,
  MaskedValue,
  parseObject,
  pretty,
  ServerPicker,
  serverName,
  TargetServers,
  targetFlags,
  useObjectOp,
  useProxyRefresh,
  useServers,
} from './-shared'

// 代理页的「入站」（web-console「代理页」，m2-18 design 第 4、5、6、10 条）：列表、详情与编辑、向导、批量新建。
// 写操作都先预演（plan 或 inbound batch plan），再照「配置的预演与提交」提交。

export interface InboundSpec {
  server_id: number
  tag: string
  protocol: string
  port: number
  listen: string
  tls: unknown
  transport: unknown
  settings: unknown
  enabled: boolean
  sort_order: number
}

export interface InboundView {
  metadata: { id: number; resourceVersion: number; deletedAt?: string | null }
  spec: InboundSpec
  derived?: { reality_public_key?: string }
  server_name?: string
}

export interface ProtocolInfo {
  protocol: string
  display_name: string
  category: string
  transports: string[]
  securities: string[]
  auth_model: string
  required_fields: string[]
  notes?: string
}

export interface ProtocolMatrix {
  kernel_version: string
  native: ProtocolInfo[]
  parallel_track: { protocol: string; status: string; notes: string }[]
  unsupported: string[]
}

// 协议矩阵只读、不含密钥，也不随主控的数据变：取一次就够了。
export const protocolsQuery = { queryKey: ['inbound protocols'], queryFn: () => run<ProtocolMatrix>('inbound protocols'), staleTime: Infinity }

interface BuildResult {
  server: string
  server_id: number
  spec: InboundSpec
  credentials: Record<string, string>
  plan_op: Record<string, unknown>
}

export function InboundsTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('proxy')
  const refresh = useProxyRefresh()
  const op = useObjectOp(refresh)
  const [draft, setDraft] = useState('')
  const [protocol, setProtocol] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [batch, setBatch] = useState(false)
  const name = server?.name ?? ''
  const list = useInfiniteQuery({
    queryKey: ['inbound list', name, protocol, includeDeleted],
    queryFn: ({ pageParam }) =>
      run<Page<InboundView>>('inbound list', {
        flags: { 'server-name': name || undefined, protocol: protocol || undefined, 'include-deleted': includeDeleted || undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const search = (e: FormEvent) => {
    e.preventDefault()
    setProtocol(draft.trim())
  }
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('inbounds.description')}</CardDescription>
        <div className="flex flex-wrap items-end gap-2">
          <form className="flex items-end gap-2" onSubmit={search}>
            <Field id="inbound-protocol" label={t('inbounds.protocolFilter')}>
              <Input id="inbound-protocol" className="w-40" value={draft} onChange={(e) => setDraft(e.target.value)} />
            </Field>
            <Button type="submit" variant="outline">
              {t('search')}
            </Button>
          </form>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={includeDeleted} onCheckedChange={setIncludeDeleted} aria-label={t('includeDeleted')} />
            {t('includeDeleted')}
          </label>
          <div className="ml-auto flex gap-2">
            <Button onClick={() => setCreating(true)}>{t('inbounds.create')}</Button>
            <Button variant="outline" onClick={() => setBatch(true)}>
              {t('inbounds.batch')}
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
              <TableHead>{t('cols.port')}</TableHead>
              <TableHead>{t('cols.listen')}</TableHead>
              <TableHead>{t('cols.enabled')}</TableHead>
              <TableHead>{t('cols.sortOrder')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground text-center">
                  {t('inbounds.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((ib) => {
              const deleted = !!ib.metadata.deletedAt
              const target = { kind: 'Inbound' as const, id: ib.metadata.id, resourceVersion: ib.metadata.resourceVersion, label: ib.spec.tag }
              return (
                <TableRow key={ib.metadata.id} data-testid={`inbound-row-${ib.metadata.id}`}>
                  <TableCell className="font-mono">{ib.metadata.id}</TableCell>
                  <TableCell>{ib.server_name ?? ib.spec.server_id}</TableCell>
                  <TableCell className="font-mono">{ib.spec.tag}</TableCell>
                  <TableCell>{ib.spec.protocol}</TableCell>
                  <TableCell className="tabular-nums">{ib.spec.port}</TableCell>
                  <TableCell className="font-mono text-xs">{ib.spec.listen || t('none')}</TableCell>
                  <TableCell>
                    {deleted ? <Badge variant="destructive">{t('deleted')}</Badge> : <Badge variant={ib.spec.enabled ? 'default' : 'outline'}>{ib.spec.enabled ? t('enabled') : t('disabled')}</Badge>}
                  </TableCell>
                  <TableCell className="tabular-nums">{ib.spec.sort_order}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {deleted ? (
                      <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'restore' })}>
                        {t('op.restore')}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setViewing(ib.metadata.id)}>
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
      {viewing !== null && <InboundDialog id={viewing} onClose={() => setViewing(null)} onApplied={refresh} />}
      {creating && <InboundWizard initialServer={server?.id ?? null} onClose={() => setCreating(false)} onApplied={refresh} />}
      {batch && <InboundBatchDialog onClose={() => setBatch(false)} onApplied={refresh} />}
      {op.dialog}
    </Card>
  )
}

// InboundDialog：详情（打码的写明、Reality 公钥）与编辑表单；表单按 resourceVersion 重置，预演结果放在表单外面。
function InboundDialog({ id, onClose, onApplied }: { id: number; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const ib = useQuery({ queryKey: ['inbound get', id], queryFn: () => run<InboundView>('inbound get', { args: [String(id)] }) })
  const [plan, setPlan] = useState<PlanView | null>(null)
  const d = ib.data
  return (
    <WideDialog title={t('inbounds.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={ib.error} />
      {d && (
        <div className="grid gap-4" data-testid="inbound-detail">
          <Fields
            rows={[
              [t('cols.server'), d.server_name ?? d.spec.server_id],
              [t('cols.protocol'), d.spec.protocol],
              [t('fields.tls'), <MaskedValue v={d.spec.tls} />],
              [t('fields.settings'), <MaskedValue v={d.spec.settings} />],
              ...(d.derived?.reality_public_key ? [[t('inbounds.realityPublicKey'), <span className="font-mono text-xs break-all">{d.derived.reality_public_key}</span>] as [string, ReactNode]] : []),
            ]}
          />
          <InboundEditForm key={d.metadata.resourceVersion} inbound={d} onPlanned={setPlan} />
        </div>
      )}
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}

// InboundEditForm 只把相对 inbound get 改过的字段放进 update（主控按合并处理，design 第 5 条）。tls 与 settings 打码时留空不发，
// 填了就整体替换；协议与服务器不能改。
function InboundEditForm({ inbound, onPlanned }: { inbound: InboundView; onPlanned: (p: PlanView) => void }) {
  const { t } = useTranslation('proxy')
  const s = inbound.spec
  const [tag, setTag] = useState(s.tag)
  const [port, setPort] = useState(String(s.port))
  const [listen, setListen] = useState(s.listen ?? '')
  const [enabled, setEnabled] = useState(s.enabled)
  const [sortOrder, setSortOrder] = useState(String(s.sort_order ?? 0))
  const [transport, setTransport] = useState(jsonText(s.transport))
  const [tls, setTls] = useState(jsonText(s.tls))
  const [settings, setSettings] = useState(jsonText(s.settings))
  const [localError, setLocalError] = useState('')
  const preview = useMutation({
    mutationFn: (changed: Record<string, unknown>) =>
      run<PlanView>('plan', { flags: { spec: JSON.stringify({ op: 'update', kind: 'Inbound', id: inbound.metadata.id, resourceVersion: inbound.metadata.resourceVersion, spec: changed }) } }),
    onSuccess: onPlanned,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changed: Record<string, unknown> = {}
    if (tag.trim() !== s.tag) changed.tag = tag.trim()
    if (Number(port) !== s.port) changed.port = Number(port)
    if (listen.trim() !== (s.listen ?? '')) changed.listen = listen.trim()
    if (enabled !== s.enabled) changed.enabled = enabled
    if (Number(sortOrder || 0) !== (s.sort_order ?? 0)) changed.sort_order = Number(sortOrder || 0)
    const objects: [string, string, unknown][] = [
      ['transport', transport, s.transport],
      ['tls', tls, s.tls],
      ['settings', settings, s.settings],
    ]
    for (const [k, text, cur] of objects) {
      const p = parseObject(text)
      if (!p.ok) return setLocalError(t('json.badField', { field: k }))
      if (p.value !== undefined && (isMasked(cur) || JSON.stringify(p.value) !== JSON.stringify(cur))) changed[k] = p.value
    }
    if (Object.keys(changed).length === 0) return setLocalError(t('edit.noChange'))
    setLocalError('')
    preview.mutate(changed)
  }
  // 留空就不发这个字段：没打码的框写明要清空得填 {}（design 第 5 条）
  const hint = (v: unknown) => (isMasked(v) ? t('json.maskedHint') : t('json.clearHint'))
  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={submit}>
      <p className="text-sm font-medium">{t('edit.title')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ib-tag" label={t('cols.tag')}>
          <Input id="ib-tag" value={tag} onChange={(e) => setTag(e.target.value)} />
        </Field>
        <Field id="ib-port" label={t('cols.port')}>
          <Input id="ib-port" type="number" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
        <Field id="ib-listen" label={t('cols.listen')}>
          <Input id="ib-listen" value={listen} onChange={(e) => setListen(e.target.value)} />
        </Field>
        <Field id="ib-sort" label={t('cols.sortOrder')}>
          <Input id="ib-sort" type="number" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('cols.enabled')} />
          {t('cols.enabled')}
        </label>
      </div>
      <JsonField id="ib-transport" label={t('fields.transport')} hint={hint(s.transport)} value={transport} onChange={setTransport} />
      <JsonField id="ib-tls" label={t('fields.tls')} hint={hint(s.tls)} value={tls} onChange={setTls} />
      <JsonField id="ib-settings" label={t('fields.settings')} hint={hint(s.settings)} value={settings} onChange={setSettings} />
      <LocalError message={localError} />
      <ErrorNotice error={preview.error} />
      <div>
        <Button type="submit" disabled={preview.isPending}>
          {t('preview')}
        </Button>
      </div>
    </form>
  )
}

// 向导的参数（design 第 4 条）。不提供 password 与 uuid：inbound build 是 GET，参数会进网址与访问日志。
interface WizardValues {
  protocol: string
  transport: string
  security: string
  port: string
  tag: string
  listen: string
  sni: string
  handshake: string
  path: string
  serviceName: string
  cipher: string
  flow: string
  certPath: string
  keyPath: string
  userName: string
  sortOrder: string
}

const EMPTY_WIZARD: WizardValues = {
  protocol: '',
  transport: '',
  security: '',
  port: '',
  tag: '',
  listen: '',
  sni: '',
  handshake: '',
  path: '',
  serviceName: '',
  cipher: '',
  flow: '',
  certPath: '',
  keyPath: '',
  userName: '',
  sortOrder: '',
}

type Optional = 'sni' | 'handshake' | 'path' | 'serviceName' | 'cipher' | 'flow' | 'certPath' | 'keyPath'

// shown 决定哪些字段对所选组合有用：只显示、只发这些。
function shown(v: WizardValues): Record<Optional, boolean> {
  const tls = v.security === 'tls'
  return {
    sni: v.security !== '' && v.security !== 'none',
    handshake: v.security === 'reality' || v.protocol === 'shadowtls',
    path: ['ws', 'http', 'httpupgrade'].includes(v.transport),
    serviceName: v.transport === 'grpc',
    cipher: v.protocol === 'shadowsocks',
    flow: v.protocol === 'vless',
    certPath: tls,
    keyPath: tls,
  }
}

const FLAG_NAMES: Record<Optional | 'tag' | 'listen' | 'userName', string> = {
  sni: 'sni',
  handshake: 'handshake',
  path: 'path',
  serviceName: 'service-name',
  cipher: 'cipher',
  flow: 'flow',
  certPath: 'cert-path',
  keyPath: 'key-path',
  tag: 'tag',
  listen: 'listen',
  userName: 'user-name',
}

// 端口选填：留空不发，由主控按服务器的端口范围与偷取模式分配（批量时每台各自分配）。
const ready = (v: WizardValues) => v.protocol !== ''

// defaultSecurity 照主控 inbound build 不传安全层时的取值：只有一种就用它，vless 加 tcp 用 reality，其余取第一种（design 第 4 条）。
function defaultSecurity(info: ProtocolInfo | undefined, transport: string): string {
  if (!info) return ''
  if (info.securities.length === 1) return info.securities[0]!
  if (info.protocol === 'vless' && transport === 'tcp' && info.securities.includes('reality')) return 'reality'
  return info.securities[0] ?? ''
}

function wizardFlags(v: WizardValues): Record<string, FlagValue> {
  const on = shown(v)
  const flags: Record<string, FlagValue> = { protocol: v.protocol, port: v.port.trim() ? Number(v.port) : undefined, transport: v.transport || undefined, security: v.security || undefined }
  for (const [k, flag] of Object.entries(FLAG_NAMES) as [keyof typeof FLAG_NAMES, string][]) {
    const visible = k === 'tag' || k === 'listen' || k === 'userName' ? true : on[k]
    const value = v[k].trim()
    if (visible && value) flags[flag] = value
  }
  if (v.sortOrder.trim()) flags['sort-order'] = Number(v.sortOrder)
  return flags
}

function WizardFields(props: { v: WizardValues; set: (p: Partial<WizardValues>) => void; matrix: ProtocolInfo[]; prefix: string; disabled?: boolean }) {
  const { v, set, matrix, prefix, disabled } = props
  const { t } = useTranslation('proxy')
  const info = matrix.find((p) => p.protocol === v.protocol)
  const on = shown(v)
  const label = (k: string) => t(`wizard.fields.${k}` as 'wizard.fields.port')
  const text = (k: keyof WizardValues, extra?: { type?: string; hint?: string }) => (
    <Field key={k} id={`${prefix}-${k}`} label={label(k)} hint={extra?.hint}>
      <Input id={`${prefix}-${k}`} type={extra?.type ?? 'text'} value={v[k]} disabled={disabled} onChange={(e) => set({ [k]: e.target.value })} />
    </Field>
  )
  const select = (k: 'protocol' | 'transport' | 'security', options: { value: string; label: string }[], onChange: (value: string) => void) => (
    <Field id={`${prefix}-${k}`} label={label(k)}>
      <Select value={v[k]} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={`${prefix}-${k}`} aria-label={label(k)}>
          <SelectValue placeholder={t('wizard.choose')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
  const pickProtocol = (p: string) => {
    const next = matrix.find((x) => x.protocol === p)
    const transport = next?.transports[0] ?? ''
    set({ protocol: p, transport, security: defaultSecurity(next, transport) })
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {select(
        'protocol',
        matrix.map((p) => ({ value: p.protocol, label: p.display_name })),
        pickProtocol,
      )}
      {info &&
        select(
          'transport',
          info.transports.map((x) => ({ value: x, label: x })),
          // 换传输层时只在安全层还是旧的默认值时才跟着重算，管理员自己选的不改
          (x) => set({ transport: x, security: v.security === defaultSecurity(info, v.transport) ? defaultSecurity(info, x) : v.security }),
        )}
      {info &&
        select(
          'security',
          info.securities.map((x) => ({ value: x, label: x })),
          (x) => set({ security: x }),
        )}
      {text('port', { type: 'number', hint: t('wizard.portHint') })}
      {text('tag', { hint: t('wizard.tagHint') })}
      {text('listen')}
      {on.sni && text('sni')}
      {on.handshake && text('handshake')}
      {on.path && text('path')}
      {on.serviceName && text('serviceName')}
      {on.cipher && text('cipher', { hint: t('wizard.cipherHint') })}
      {on.flow && text('flow')}
      {on.certPath && text('certPath')}
      {on.keyPath && text('keyPath')}
      {text('userName')}
      {text('sortOrder', { type: 'number' })}
      {info?.notes && <p className="text-muted-foreground text-xs sm:col-span-2">{info.notes}</p>}
    </div>
  )
}

// InboundWizard：「生成」调 inbound build（不进浏览器缓存），主控生成的凭据只在这里显示一次；生成的配置可以改，
// 「预演」把它的原文作为 spec 交给 plan，再照 PlanReview 提交（design 第 4 条）。
function InboundWizard({ initialServer, onClose, onApplied }: { initialServer: number | null; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const dialogs = useDialogs()
  const servers = useServers()
  const matrix = useQuery(protocolsQuery)
  const [serverId, setServerId] = useState<number | null>(initialServer)
  const [v, setV] = useState<WizardValues>(EMPTY_WIZARD)
  const [config, setConfig] = useState('')
  const [localError, setLocalError] = useState('')
  // 提交之后（成功或部分节点失败）这套凭据已经在用：向导锁住，不能再生成，免得把正在用的凭据从页面上换掉
  const [applied, setApplied] = useState(false)
  // 生成时的参数：之后改了参数（还没提交）就不能拿旧的配置去预演，要重新生成；直接改「生成的配置」框不算
  const [builtFor, setBuiltFor] = useState('')
  const params = JSON.stringify([serverId, v])
  const preview = useMutation({ mutationFn: (spec: string) => run<PlanView>('plan', { flags: { spec } }) })
  const set = (p: Partial<WizardValues>) => {
    setV((prev) => ({ ...prev, ...p }))
    preview.reset()
  }
  const pickServer = (id: number | null) => {
    setServerId(id)
    preview.reset()
  }
  const build = useMutation({
    mutationFn: () => run<BuildResult>('inbound build', { flags: { 'server-name': serverName(servers, serverId), ...wizardFlags(v) }, noStore: true }),
    onSuccess: (r) => {
      setConfig(pretty(r.plan_op))
      setLocalError('')
      preview.reset()
    },
  })
  const stale = !!build.data && !applied && builtFor !== params
  const generate = (e: FormEvent) => {
    e.preventDefault()
    setBuiltFor(params)
    build.mutate()
  }
  const runPreview = () => {
    const p = parseObject(config)
    if (!p.ok || p.value === undefined) return setLocalError(t('json.bad'))
    setLocalError('')
    preview.mutate(config)
  }
  // 凭据只显示这一次：显示着的时候，点外面、按 Esc 或点关闭都先确认
  const guard = build.data ? () => dialogs.confirm({ title: t('wizard.closeTitle'), description: t('wizard.closeDescription'), destructive: true }) : undefined
  return (
    <WideDialog title={t('wizard.title')} description={t('wizard.description')} onClose={onClose} guard={guard}>
      <form className="grid gap-4" onSubmit={generate}>
        <Field id="wiz-server" label={t('server.label')}>
          <ServerPicker id="wiz-server" label={t('server.label')} value={serverId} onChange={pickServer} disabled={applied} />
        </Field>
        <ErrorNotice error={matrix.error} />
        {matrix.data && <WizardFields v={v} set={set} matrix={matrix.data.native} prefix="wiz" disabled={applied} />}
        <p className="text-muted-foreground text-sm">{t('wizard.noSecrets')}</p>
        <ErrorNotice error={build.error} />
        {applied ? (
          <Alert data-testid="wizard-locked">
            <AlertDescription>{t('wizard.locked')}</AlertDescription>
          </Alert>
        ) : (
          <div>
            <Button type="submit" disabled={serverId === null || !ready(v) || build.isPending}>
              {t('wizard.generate')}
            </Button>
          </div>
        )}
      </form>
      {build.data && (
        <div className="grid gap-3" data-testid="wizard-result">
          <Alert>
            <AlertTitle>{t('wizard.credentialsTitle')}</AlertTitle>
            <AlertDescription>{t('wizard.credentialsNote')}</AlertDescription>
          </Alert>
          <CopyRows values={build.data.credentials} label={(k) => t(`credentials.${k}` as 'credentials.uuid', { defaultValue: k })} />
          <JsonField id="wiz-config" label={t('wizard.config')} hint={t('wizard.configHint')} value={config} onChange={setConfig} />
          {stale && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t('wizard.stale')}</AlertDescription>
            </Alert>
          )}
          <LocalError message={localError} />
          <ErrorNotice error={preview.error} />
          {!applied && (
            <div>
              <Button onClick={runPreview} disabled={stale || preview.isPending}>
                {t('preview')}
              </Button>
            </div>
          )}
          {preview.data && (
            <PlanReview
              key={preview.data.plan_id}
              plan={preview.data}
              onApplied={() => {
                setApplied(true)
                onApplied()
              }}
            />
          )}
        </div>
      )}
    </WideDialog>
  )
}

type BatchMode = 'wizard' | 'template'

// InboundBatchDialog：目标服务器（全部或勾选）加向导参数或 JSON 模板，调 inbound batch plan 得到一份计划（design 第 10 条）。
// 每台各自生成的凭据在计划里是打码的，网页上看不到。
function InboundBatchDialog({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const matrix = useQuery(protocolsQuery)
  const [targets, setTargets] = useState(EMPTY_TARGETS)
  const [mode, setMode] = useState<BatchMode>('wizard')
  const [v, setV] = useState<WizardValues>(EMPTY_WIZARD)
  const set = (p: Partial<WizardValues>) => setV((prev) => ({ ...prev, ...p }))
  const [template, setTemplate] = useState('')
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (flags: Record<string, FlagValue>) => run<PlanView>('inbound batch plan', { flags }) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'template') {
      const p = parseObject(template)
      if (!p.ok || p.value === undefined) return setLocalError(t('json.bad'))
      setLocalError('')
      return preview.mutate({ ...targetFlags(targets), spec: template })
    }
    setLocalError('')
    preview.mutate({ ...targetFlags(targets), ...wizardFlags(v) })
  }
  const canPreview = hasTargets(targets) && (mode === 'wizard' ? ready(v) : template.trim() !== '')
  return (
    <WideDialog title={t('inbounds.batchTitle')} description={t('inbounds.batchDescription')} onClose={onClose}>
      <form className="grid gap-4" onSubmit={submit}>
        <TargetServers value={targets} onChange={setTargets} />
        <Field id="ib-batch-mode" label={t('batch.mode')}>
          <Select value={mode} onValueChange={(m) => setMode(m as BatchMode)}>
            <SelectTrigger id="ib-batch-mode" aria-label={t('batch.mode')} className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="wizard">{t('batch.modes.wizard')}</SelectItem>
              <SelectItem value="template">{t('batch.modes.template')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {mode === 'wizard' ? (
          <>
            <ErrorNotice error={matrix.error} />
            {matrix.data && <WizardFields v={v} set={set} matrix={matrix.data.native} prefix="ib-batch" />}
          </>
        ) : (
          <JsonField id="ib-batch-template" label={t('batch.template')} hint={t('batch.templateHint')} value={template} onChange={setTemplate} />
        )}
        <Alert>
          <AlertDescription>{t('inbounds.batchSecrets')}</AlertDescription>
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
