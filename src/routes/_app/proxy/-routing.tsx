import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
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
import { Field, JsonField, jsonText, LocalError, parseObject, ServerPicker, useObjectOp, useProxyRefresh, useServers } from './-shared'

// 代理页的「路由」（web-console「代理页」，m2-20 design 第 1 到 4 条）：列表、详情与编辑、新建、删除与恢复。
// 匹配条件只用 JSON 框，合不合法、出站在不在都由主控在预演时判定。

interface RoutingRuleSpec {
  server_id: number
  sort_order: number
  match: unknown
  outbound_tag: string
  enabled: boolean
  catch_all: boolean
}

interface RoutingRuleView {
  metadata: { id: number; resourceVersion: number; deletedAt?: string | null }
  spec: RoutingRuleSpec
  server_name?: string
  is_inbound_catch_all: boolean
  shadowed_by?: number[] | null
}

// RuleDraft 是从预设新建规则时填进表单的值（design 第 5 条）：内置预设带默认出站，已保存的预设只有匹配条件。
export interface RuleDraft {
  preset: string
  match: unknown
  outboundTag?: string
}

const BUILTIN_OUTBOUNDS = ['direct', 'block', 'reject']

// short 把匹配条件写成一行紧凑的 JSON，超过 80 个字符时截断（完整内容在详情里，design 第 4 条）。
export function short(v: unknown): string {
  const s = JSON.stringify(v ?? {})
  return s.length > 80 ? `${s.slice(0, 79)}…` : s
}

export function RoutingTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('proxy')
  const refresh = useProxyRefresh()
  const op = useObjectOp(refresh)
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const name = server?.name ?? ''
  const list = useInfiniteQuery({
    queryKey: ['routing list', name, includeDeleted],
    queryFn: ({ pageParam }) =>
      run<Page<RoutingRuleView>>('routing list', {
        flags: { 'server-name': name || undefined, 'include-deleted': includeDeleted || undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('routing.description')}</CardDescription>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex items-center gap-2 pb-2 text-sm">
            <Switch checked={includeDeleted} onCheckedChange={setIncludeDeleted} aria-label={t('includeDeleted')} />
            {t('includeDeleted')}
          </label>
          <div className="ml-auto">
            <Button onClick={() => setCreating(true)}>{t('routing.create')}</Button>
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
              <TableHead>{t('cols.sortOrder')}</TableHead>
              <TableHead>{t('cols.match')}</TableHead>
              <TableHead>{t('cols.outbound')}</TableHead>
              <TableHead>{t('cols.enabled')}</TableHead>
              <TableHead>{t('cols.notes')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground text-center">
                  {t('routing.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => {
              const deleted = !!r.metadata.deletedAt
              const label = t('routing.opLabel', { server: r.server_name ?? r.spec.server_id, outbound: r.spec.outbound_tag })
              const target = { kind: 'RoutingRule' as const, id: r.metadata.id, resourceVersion: r.metadata.resourceVersion, label }
              return (
                <TableRow key={r.metadata.id} data-testid={`routing-row-${r.metadata.id}`}>
                  <TableCell className="font-mono">{r.metadata.id}</TableCell>
                  <TableCell>{r.server_name ?? r.spec.server_id}</TableCell>
                  <TableCell className="tabular-nums">{r.spec.sort_order}</TableCell>
                  <TableCell className="max-w-80 font-mono text-xs break-all whitespace-normal">{short(r.spec.match)}</TableCell>
                  <TableCell className="font-mono">{r.spec.outbound_tag}</TableCell>
                  <TableCell>{deleted ? <Badge variant="destructive">{t('deleted')}</Badge> : r.spec.enabled ? t('enabled') : t('disabled')}</TableCell>
                  <TableCell>
                    <RuleNotes rule={r} />
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {deleted ? (
                      <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'restore' })}>
                        {t('op.restore')}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setViewing(r.metadata.id)}>
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
      {viewing !== null && <RoutingDialog id={viewing} onClose={() => setViewing(null)} onApplied={refresh} />}
      {creating && <NewRuleDialog initialServer={server?.id ?? null} onClose={() => setCreating(false)} onApplied={refresh} />}
      {op.dialog}
    </Card>
  )
}

// matchesAll：没删除、启用着、不是整机兜底、匹配条件为空的规则匹配这台服务器的全部流量，后面的规则都被它遮蔽（design 第 4 条）。
const matchesAll = (r: RoutingRuleView) =>
  !r.metadata.deletedAt && r.spec.enabled && !r.spec.catch_all && (r.spec.match == null || (typeof r.spec.match === 'object' && Object.keys(r.spec.match).length === 0))

const hasNotes = (r: RoutingRuleView) => r.spec.catch_all || matchesAll(r) || r.is_inbound_catch_all || (r.shadowed_by ?? []).length > 0

// RuleNotes 写出整机兜底、匹配全部流量，以及主控标的入站全兜底与遮蔽（design 第 4 条）。
function RuleNotes({ rule }: { rule: RoutingRuleView }) {
  const { t } = useTranslation('proxy')
  const shadowed = rule.shadowed_by ?? []
  return (
    <span className="flex flex-wrap gap-1">
      {rule.spec.catch_all && <Badge variant="secondary">{t('routing.catchAll')}</Badge>}
      {matchesAll(rule) && <Badge variant="secondary">{t('routing.matchesAll')}</Badge>}
      {rule.is_inbound_catch_all && <Badge variant="secondary">{t('routing.inboundCatchAll')}</Badge>}
      {shadowed.length > 0 && <Badge variant="destructive">{t('routing.shadowedBy', { ids: shadowed.map((id) => `#${id}`).join(t('routing.idSep')) })}</Badge>}
    </span>
  )
}

function RoutingDialog({ id, onClose, onApplied }: { id: number; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('proxy')
  const rule = useQuery({ queryKey: ['routing get', id], queryFn: () => run<RoutingRuleView>('routing get', { args: [String(id)] }) })
  // 计划放在表单外面：提交会抬高版本、表单按新版本重新挂载，预演与提交的结果仍然留着
  const [plan, setPlan] = useState<PlanView | null>(null)
  const d = rule.data
  return (
    <WideDialog title={t('routing.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={rule.error} />
      {d && (
        <div className="grid gap-4" data-testid="routing-detail">
          <Fields
            rows={[
              [t('cols.server'), d.server_name ?? d.spec.server_id],
              [t('cols.notes'), hasNotes(d) ? <RuleNotes rule={d} /> : t('none')],
            ]}
          />
          <RuleForm key={d.metadata.resourceVersion} rule={d} onPlanned={setPlan} />
        </div>
      )}
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}

// NewRuleDialog 新建一条路由规则；「预设」里的「用它新建规则」也打开它，带上预设的值（design 第 5 条）。
// 提交之后（成功或部分节点失败）表单锁住：路由规则没有唯一约束，再预演、再提交会多出一条一样的规则。
export function NewRuleDialog(props: { initialServer: number | null; draft?: RuleDraft; onClose: () => void; onApplied: () => void }) {
  const { initialServer, draft, onClose, onApplied } = props
  const { t } = useTranslation('proxy')
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [applied, setApplied] = useState(false)
  const done = () => {
    setApplied(true)
    onApplied()
  }
  return (
    <WideDialog title={t('routing.createTitle')} description={draft ? t('routing.fromPreset', { name: draft.preset }) : undefined} onClose={onClose}>
      <RuleForm initialServer={initialServer} draft={draft} onPlanned={setPlan} locked={applied} />
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={done} />}
    </WideDialog>
  )
}

// RuleForm 新建或编辑一条路由规则（design 第 2 条）。新建时排序默认 100、启用，匹配条件留空发 {}；
// 编辑只发改过的字段，匹配条件留空不发（要清空填 {}）。出站不在网页上判定：带 action 的规则可以没有出站。
function RuleForm(props: { rule?: RoutingRuleView; initialServer?: number | null; draft?: RuleDraft; onPlanned: (p: PlanView) => void; locked?: boolean }) {
  const { rule, initialServer = null, draft, onPlanned, locked = false } = props
  const { t } = useTranslation('proxy')
  const servers = useServers()
  const s = rule?.spec
  const [serverId, setServerId] = useState<number | null>(s?.server_id ?? initialServer)
  const [sortOrder, setSortOrder] = useState(String(s?.sort_order ?? 100))
  const [match, setMatch] = useState(jsonText(s ? s.match : draft?.match))
  const [outbound, setOutbound] = useState(s?.outbound_tag ?? draft?.outboundTag ?? '')
  const [enabled, setEnabled] = useState(s?.enabled ?? true)
  const [catchAll, setCatchAll] = useState(s?.catch_all ?? false)
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (op: object) => run<PlanView>('plan', { flags: { spec: JSON.stringify(op) } }), onSuccess: onPlanned })
  const name = rule?.server_name || servers.find((x) => x.id === serverId)?.name || ''
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const pm = parseObject(match)
    if (!pm.ok) return setLocalError(t('json.badField', { field: 'match' }))
    const sort = Number(sortOrder)
    if (!s) {
      setLocalError('')
      return preview.mutate({
        op: 'create',
        kind: 'RoutingRule',
        spec: { server_id: serverId, sort_order: sort, match: pm.value ?? {}, outbound_tag: outbound, enabled, catch_all: catchAll },
      })
    }
    const changed: Record<string, unknown> = {}
    if (sort !== s.sort_order) changed.sort_order = sort
    if (pm.value !== undefined && JSON.stringify(pm.value) !== JSON.stringify(s.match)) changed.match = pm.value
    if (outbound !== s.outbound_tag) changed.outbound_tag = outbound
    if (enabled !== s.enabled) changed.enabled = enabled
    if (catchAll !== s.catch_all) changed.catch_all = catchAll
    if (Object.keys(changed).length === 0) return setLocalError(t('edit.noChange'))
    setLocalError('')
    preview.mutate({ op: 'update', kind: 'RoutingRule', id: rule.metadata.id, resourceVersion: rule.metadata.resourceVersion, spec: changed })
  }
  const canPreview = sortOrder.trim() !== '' && (s ? true : serverId !== null)
  return (
    <div className="grid gap-3 rounded-md border p-3">
      <form className="grid gap-3" onSubmit={submit}>
        {s && <p className="text-sm font-medium">{t('edit.title')}</p>}
        <fieldset className="grid gap-3" disabled={locked}>
          <div className="grid gap-3 sm:grid-cols-2">
            {!s && (
              <Field id="rule-server" label={t('server.label')}>
                <ServerPicker id="rule-server" label={t('server.label')} value={serverId} onChange={setServerId} />
              </Field>
            )}
            <Field id="rule-sort" label={t('cols.sortOrder')}>
              <Input id="rule-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </Field>
            <Field id="rule-outbound" label={t('cols.outbound')} hint={t('routing.outboundHint')}>
              <OutboundSelect id="rule-outbound" server={name} value={outbound} onChange={setOutbound} />
            </Field>
          </div>
          <JsonField id="rule-match" label={t('fields.match')} hint={s ? t('json.clearHint') : t('routing.matchHint')} value={match} onChange={setMatch} />
          <div className="grid gap-1">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={t('enabled')} />
                {t('enabled')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={catchAll} onCheckedChange={setCatchAll} aria-label={t('fields.catchAll')} />
                {t('fields.catchAll')}
              </label>
            </div>
            <p className="text-muted-foreground text-xs">{t('routing.catchAllHint')}</p>
          </div>
        </fieldset>
        <LocalError message={localError} />
        <ErrorNotice error={preview.error} />
        {locked ? (
          <p className="text-muted-foreground text-sm" data-testid="rule-locked">
            {t('routing.locked')}
          </p>
        ) : (
          <div>
            <Button type="submit" disabled={!canPreview || preview.isPending}>
              {t('preview')}
            </Button>
          </div>
        )}
      </form>
      <SaveAsPreset rule={match} />
    </div>
  )
}

interface OutboundOption {
  tag: string
  kind: 'outbound' | 'group' | 'builtin' | 'missing'
}

// outboundOptions 列出一台服务器上能选的出站（design 第 3 条）：出站 tag、去重后的负载均衡组、内置的三项；
// 当前值不在里面时也列出来，读到这台服务器的出站之后写明「这台服务器上没有」。
export function outboundOptions(outbounds: { spec: { tag: string; balancer_group: string } }[], current: string, loaded: boolean): OutboundOption[] {
  const out: OutboundOption[] = []
  const add = (tag: string, kind: OutboundOption['kind']) => {
    if (tag && !out.some((o) => o.tag === tag)) out.push({ tag, kind })
  }
  for (const o of outbounds) add(o.spec.tag, 'outbound')
  for (const o of outbounds) add(o.spec.balancer_group, 'group')
  for (const tag of BUILTIN_OUTBOUNDS) add(tag, 'builtin')
  add(current, loaded ? 'missing' : 'outbound')
  return out
}

function OutboundSelect({ id, server, value, onChange }: { id: string; server: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('proxy')
  const list = useQuery({
    queryKey: ['outbound list', 'options', server],
    queryFn: () => run<Page<{ spec: { tag: string; balancer_group: string } }>>('outbound list', { flags: { 'server-name': server }, limit: 500 }),
    enabled: server !== '',
  })
  const options = outboundOptions(list.data?.items ?? [], value, list.isSuccess)
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={t('cols.outbound')}>
        <SelectValue placeholder={t('routing.chooseOutbound')} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.tag} value={o.tag}>
            {t(`routing.outboundOption.${o.kind}`, { tag: o.tag })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// useSavePreset 调 routing preset save（design 第 6 条）：rule 必须是 JSON 对象，发输入框的原文；成功后让预设列表重新读取。
// 网页不提供 --owner，管理员会话保存的预设归自己。
export function useSavePreset(onSaved: () => void) {
  const { t } = useTranslation('proxy')
  const queryClient = useQueryClient()
  const [localError, setLocalError] = useState('')
  const save = useMutation({
    mutationFn: (flags: { name: string; rule: string }) => run('routing preset save', { flags }),
    onSuccess: () => {
      toast.success(t('presets.saved'))
      onSaved()
      return queryClient.invalidateQueries({ queryKey: ['routing preset list'] })
    },
  })
  const submit = (name: string, rule: string) => {
    const p = parseObject(rule)
    if (!p.ok || p.value === undefined) return setLocalError(t('json.badField', { field: 'match' }))
    setLocalError('')
    save.mutate({ name: name.trim(), rule })
  }
  return { submit, localError, save }
}

// SaveAsPreset 是规则表单里的「存为预设」：展开一行名字输入框，用匹配条件框当前的内容（不套第二层对话框）。
function SaveAsPreset({ rule }: { rule: string }) {
  const { t } = useTranslation('proxy')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const { submit, localError, save } = useSavePreset(() => {
    setOpen(false)
    setName('')
  })
  if (!open)
    return (
      <div>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t('presets.saveAs')}
        </Button>
      </div>
    )
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(name, rule)
  }
  return (
    <form className="grid gap-2" onSubmit={onSubmit} data-testid="save-as-preset">
      <div className="flex flex-wrap items-end gap-2">
        <Field id="rule-preset-name" label={t('presets.name')}>
          <Input id="rule-preset-name" className="w-56" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!name.trim() || save.isPending}>
          {t('presets.saveSubmit')}
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">{t('presets.saveAsHint')}</p>
      <LocalError message={localError} />
      <ErrorNotice error={save.error} />
    </form>
  )
}
