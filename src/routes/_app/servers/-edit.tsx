import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerObject } from '@/components/ServerStatus'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatBytes } from '@/lib/format'

import { PlanReview, type ApplyResult, type PlanView } from '../-plan'
import { serverQuery } from './-shared'

// 服务器的「编辑」标签页（web-console「服务器页」，m2-16 design 第 4、5 条）：分组表单加一个 JSON 编辑框，只把相对
// server get 改过的字段发给 plan（主控按合并处理），再照「配置的预演与提交」提交。底部是软删除与恢复。

type FieldKind = 'text' | 'number' | 'bool' | 'select'
interface FieldDef {
  name: string
  kind: FieldKind
  options?: readonly string[]
}

// GROUPS 是表单里的字段；下拉框只用于主控有固定取值的字段，其余文本照填，取值由主控判定。
const GROUPS: { key: string; fields: FieldDef[] }[] = [
  {
    key: 'basic',
    fields: [
      { name: 'name', kind: 'text' },
      { name: 'sort_order', kind: 'number' },
    ],
  },
  {
    key: 'conn',
    fields: [
      { name: 'connection_mode', kind: 'select', options: ['auto', 'websocket', 'http', 'pull'] },
      { name: 'domain', kind: 'text' },
      { name: 'domain_v6', kind: 'text' },
      { name: 'listen_port', kind: 'number' },
      { name: 'pull_address', kind: 'text' },
      { name: 'pull_address_v6', kind: 'text' },
      { name: 'pull_port', kind: 'number' },
      { name: 'ipv6_enabled', kind: 'bool' },
      { name: 'lock_entry_ip', kind: 'bool' },
    ],
  },
  {
    key: 'traffic',
    fields: [
      { name: 'traffic_limit', kind: 'number' },
      { name: 'traffic_reset_day', kind: 'number' },
      { name: 'traffic_calibration', kind: 'number' },
      { name: 'traffic_stats_mode', kind: 'select', options: ['both', 'upload', 'download', 'max'] },
      { name: 'traffic_source', kind: 'select', options: ['core', 'system'] },
      { name: 'include_in_traffic_stats', kind: 'bool' },
    ],
  },
  {
    key: 'region',
    fields: [
      { name: 'region', kind: 'text' },
      { name: 'region_country', kind: 'text' },
      { name: 'region_name', kind: 'text' },
      { name: 'region_city', kind: 'text' },
      { name: 'renewal_price', kind: 'number' },
      { name: 'renewal_cycle', kind: 'text' },
      { name: 'renewal_currency', kind: 'text' },
      { name: 'provider_name', kind: 'text' },
      { name: 'provider_url', kind: 'text' },
      { name: 'telecom_paid_peer', kind: 'bool' },
    ],
  },
  {
    key: 'core',
    fields: [
      { name: 'core_log_level', kind: 'text' },
      { name: 'core_stats_enabled', kind: 'bool' },
    ],
  },
]
const FORM_FIELDS = GROUPS.flatMap((g) => g.fields)
const FORM_NAMES = new Set(FORM_FIELDS.map((f) => f.name))

type Values = Record<string, string | boolean>
type Spec = Record<string, unknown>

const initialValue = (f: FieldDef, v: unknown): string | boolean => (f.kind === 'bool' ? v === true : v === null || v === undefined ? '' : String(v))

// changedSpec 比较表单与 JSON 框里的值和当前 spec，只留不同的字段；JSON 解析不了或不是对象时返回 null。
function changedSpec(spec: Spec, values: Values, json: string): Spec | null {
  let extra: unknown
  try {
    extra = JSON.parse(json)
  } catch {
    return null
  }
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return null
  const out: Spec = {}
  for (const f of FORM_FIELDS) {
    const cur = spec[f.name]
    const v = values[f.name]
    if (f.kind === 'bool') {
      if (v !== (cur === true)) out[f.name] = v
    } else if (f.kind === 'number') {
      const n = Number(v === '' ? 0 : v)
      if (n !== Number(cur ?? 0)) out[f.name] = n
    } else if (v !== (cur === null || cur === undefined ? '' : String(cur))) {
      out[f.name] = v
    }
  }
  for (const [k, v] of Object.entries(extra as Spec)) {
    if (FORM_NAMES.has(k)) continue
    if (JSON.stringify(v) !== JSON.stringify(spec[k])) out[k] = v
  }
  return out
}

export function EditTab({ name }: { name: string }) {
  const { t } = useTranslation('servers')
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const server = useQuery(serverQuery(name))
  // 计划放在表单外面：提交成功后版本号变了、表单按新值重置，预演结果与提交结果仍然留着
  const [plan, setPlan] = useState<{ view: PlanView; rename: string | null } | null>(null)
  // 主控库已写入（成功或部分节点失败）后重新读取；改了名字时先转到新名字的详情页，并丢掉旧名字的查询
  // （旧名字已经不存在，重新请求只会得到 not_found，页面会闪一下）
  const onApplied = async () => {
    toast.success(t('edit.applied'))
    void queryClient.invalidateQueries({ queryKey: ['server list'] })
    if (plan?.rename) {
      await navigate({ to: '/servers/$name', params: { name: plan.rename } })
      queryClient.removeQueries({ queryKey: ['server get', name] })
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['server get', name] })
  }
  return (
    <div className="grid gap-4">
      <ErrorNotice error={server.error} />
      {server.data && (
        <EditForm
          key={server.data.metadata.resourceVersion ?? 0}
          server={server.data}
          onPlanned={(view, rename) => setPlan({ view, rename })}
        />
      )}
      {plan && (
        <Card className="shadow-flat">
          <CardHeader>
            <CardTitle>{t('edit.planTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PlanReview key={plan.view.plan_id} plan={plan.view} onApplied={() => void onApplied()} />
          </CardContent>
        </Card>
      )}
      <DeleteCard name={name} server={server.data} />
    </div>
  )
}

function EditForm({ server, onPlanned }: { server: ServerObject; onPlanned: (plan: PlanView, rename: string | null) => void }) {
  const { t } = useTranslation('servers')
  const spec = server.spec as unknown as Spec
  const [values, setValues] = useState<Values>(() => Object.fromEntries(FORM_FIELDS.map((f) => [f.name, initialValue(f, spec[f.name])])))
  const initialJson = JSON.stringify(Object.fromEntries(Object.entries(spec).filter(([k]) => !FORM_NAMES.has(k))), null, 2)
  const [json, setJson] = useState(initialJson)
  const [localError, setLocalError] = useState('')
  const dirty = json !== initialJson || FORM_FIELDS.some((f) => values[f.name] !== initialValue(f, spec[f.name]))
  const preview = useMutation({
    mutationFn: (changed: Spec) =>
      run<PlanView>('plan', {
        flags: { spec: JSON.stringify({ op: 'update', kind: 'Server', id: server.metadata.id, resourceVersion: server.metadata.resourceVersion, spec: changed }) },
      }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changed = changedSpec(spec, values, json)
    if (!changed) return setLocalError(t('edit.badJson'))
    if (Object.keys(changed).length === 0) return setLocalError(t('edit.noChange'))
    setLocalError('')
    const rename = typeof changed.name === 'string' ? changed.name : null
    preview.mutate(changed, { onSuccess: (view) => onPlanned(view, rename) })
  }
  const set = (k: string, v: string | boolean) => setValues((prev) => ({ ...prev, [k]: v }))
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('edit.title')}</CardTitle>
        <CardDescription>{t('edit.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={submit}>
          {GROUPS.map((g) => (
            <fieldset key={g.key} className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{t(`edit.groups.${g.key}` as 'edit.groups.basic')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <FieldInput key={f.name} def={f} value={values[f.name]!} onChange={(v) => set(f.name, v)} />
                ))}
              </div>
            </fieldset>
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor="edit-json">{t('edit.json')}</Label>
            <p className="text-muted-foreground text-sm">{t('edit.jsonHint')}</p>
            <Textarea id="edit-json" className="min-h-48 font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
          </div>
          {localError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{localError}</AlertDescription>
            </Alert>
          )}
          <ErrorNotice error={preview.error} />
          <div>
            <Button type="submit" disabled={!dirty || preview.isPending}>
              {t('edit.preview')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function FieldInput({ def: f, value, onChange }: { def: FieldDef; value: string | boolean; onChange: (v: string | boolean) => void }) {
  const { t } = useTranslation('servers')
  const id = `edit-${f.name}`
  const label = t(`edit.fields.${f.name}` as 'edit.fields.name')
  if (f.kind === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={value === true} onCheckedChange={onChange} aria-label={label} />
        {label}
      </label>
    )
  }
  if (f.kind === 'select') {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger id={id} aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {f.options!.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={f.kind === 'number' ? 'number' : 'text'} inputMode={f.kind === 'number' ? 'decimal' : undefined} value={String(value)} onChange={(e) => onChange(e.target.value)} />
      {f.name === 'traffic_limit' && <p className="text-muted-foreground text-xs">{Number(value) > 0 ? formatBytes(Number(value)) : t('edit.unlimited')}</p>}
    </div>
  )
}

interface Deleted {
  id: number
  name: string
  resourceVersion: number
}

// DeleteCard：软删除与恢复都走预演与提交。删除成功后 server get 会查不到，所以删除后的 id 与版本号存在这里，「恢复」不依赖 server get。
function DeleteCard({ name, server }: { name: string; server: ServerObject | undefined }) {
  const { t } = useTranslation('servers')
  const queryClient = useQueryClient()
  const [plan, setPlan] = useState<PlanView | null>(null)
  const [deleted, setDeleted] = useState<Deleted | null>(null)
  const preview = useMutation({
    mutationFn: (op: object) => run<PlanView>('plan', { flags: { spec: JSON.stringify(op) } }),
    onSuccess: setPlan,
  })
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['server get', name] }), queryClient.invalidateQueries({ queryKey: ['server list'] })])
  const onApplied = async (r: ApplyResult) => {
    const obj = r.objects?.find((o) => o.kind === 'Server')
    if (obj?.op === 'delete') setDeleted({ id: obj.id, name: obj.name, resourceVersion: obj.resourceVersion })
    if (obj?.op === 'restore') setDeleted(null)
    await refresh()
  }
  const target = deleted ?? (server ? { id: server.metadata.id, name: server.spec.name, resourceVersion: server.metadata.resourceVersion ?? 0 } : null)
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('edit.deleteTitle')}</CardTitle>
        <CardDescription>{t('edit.deleteDescription', { id: target?.id ?? '-' })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {deleted ? (
          <Alert data-testid="server-deleted">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('edit.deleted', { name: deleted.name, id: deleted.id })}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={preview.isPending}
                onClick={() => preview.mutate({ op: 'restore', kind: 'Server', id: deleted.id, resourceVersion: deleted.resourceVersion })}
              >
                {t('edit.restore')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div>
            <Button
              variant="destructive"
              disabled={!target || preview.isPending}
              onClick={() => target && preview.mutate({ op: 'delete', kind: 'Server', id: target.id, resourceVersion: target.resourceVersion })}
            >
              {t('edit.delete')}
            </Button>
          </div>
        )}
        <ErrorNotice error={preview.error} />
        {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={(r) => void onApplied(r)} />}
      </CardContent>
    </Card>
  )
}
