import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { WideDialog } from '@/components/WideDialog'
import { copyText } from '@/lib/clipboard'

import { PlanReview, type PlanView } from '../-plan'

// 代理页共用的部件（web-console「代理页」，m2-18 design 第 1、2、6 条）。

// 主控对没有 secrets 权限的调用者把密钥类字段回成这个值（网页会话一律如此）。
export const MASKED = '***'
export const isMasked = (v: unknown) => v === MASKED

const ALL = 'all'

// 服务器选择框取 server list 的第一页（主控的上限 500 台），按 id 选、按名字显示（design 第 2 条）。
export const serversQuery = {
  queryKey: ['server list', 'proxy'],
  queryFn: () => run<Page<ServerSummary>>('server list', { limit: 500 }),
  staleTime: 30_000,
}

export function useServers(): ServerSummary[] {
  return useQuery(serversQuery).data?.items ?? []
}

export const serverName = (servers: ServerSummary[], id: number | null | undefined) => servers.find((s) => s.id === id)?.name ?? (id ? `#${id}` : '')

// ServerPicker：allowAll 时多一项「全部服务器」（值为 null）；否则没选时显示占位文字。
export function ServerPicker(props: { id: string; label: string; value: number | null; onChange: (id: number | null) => void; allowAll?: boolean; disabled?: boolean }) {
  const { id, label, value, onChange, allowAll, disabled } = props
  const { t } = useTranslation('proxy')
  const servers = useServers()
  return (
    <Select value={value === null ? (allowAll ? ALL : '') : String(value)} onValueChange={(v) => onChange(v === ALL ? null : Number(v))} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className="w-56">
        <SelectValue placeholder={t('server.choose')} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value={ALL}>{t('server.all')}</SelectItem>}
        {servers.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Targets 是批量规划的目标服务器：全部服务器，或勾选的几台（按名字发数组）。二者互斥（design 第 10 条）。
export interface Targets {
  all: boolean
  names: string[]
}

export const EMPTY_TARGETS: Targets = { all: false, names: [] }
export const hasTargets = (t: Targets) => t.all || t.names.length > 0
export const targetFlags = (t: Targets) => (t.all ? { all: true } : { servers: t.names })

export function TargetServers({ value, onChange }: { value: Targets; onChange: (v: Targets) => void }) {
  const { t } = useTranslation('proxy')
  const servers = useServers()
  const toggle = (name: string, on: boolean) => onChange({ all: false, names: on ? [...value.names, name] : value.names.filter((n) => n !== name) })
  return (
    <fieldset className="grid gap-2 rounded-md border p-3">
      <legend className="px-1 text-sm font-medium">{t('batch.targets')}</legend>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={value.all} onCheckedChange={(on) => onChange({ all: on, names: [] })} aria-label={t('batch.all')} />
        {t('batch.all')}
      </label>
      {!value.all && (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {servers.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.names.includes(s.name)} onCheckedChange={(on) => toggle(s.name, on === true)} aria-label={s.name} />
              {s.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

// parseObject 解析一个 JSON 输入框：留空是 undefined（不发这个字段）；解析不了或不是对象时 ok 为假。
export type Parsed = { ok: true; value: Record<string, unknown> | undefined } | { ok: false }

export function parseObject(text: string): Parsed {
  if (!text.trim()) return { ok: true, value: undefined }
  try {
    const v: unknown = JSON.parse(text)
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, value: v as Record<string, unknown> }
  } catch {
    // 落到下面
  }
  return { ok: false }
}

export const pretty = (v: unknown) => JSON.stringify(v, null, 2)

// jsonText 把对象字段写进输入框：空对象与空值写成空，打码的也写成空（留空不改，design 第 5 条）。
export function jsonText(v: unknown): string {
  if (v === null || v === undefined || isMasked(v)) return ''
  if (typeof v === 'object' && Object.keys(v).length === 0) return ''
  return pretty(v)
}

export function JsonField(props: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const { id, label, value, onChange, hint } = props
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
      <Textarea id={id} className="min-h-24 font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// MaskedValue 显示一个可能被打码的对象字段：打码时写明，空时写「无」，否则按 JSON。
export function MaskedValue({ v }: { v: unknown }) {
  const { t } = useTranslation('proxy')
  if (isMasked(v)) return <span className="text-muted-foreground">{t('masked')}</span>
  if (v === null || v === undefined || (typeof v === 'object' && Object.keys(v).length === 0)) return <span className="text-muted-foreground">{t('none')}</span>
  return <pre className="bg-muted overflow-auto rounded-md p-2 font-mono text-xs">{pretty(v)}</pre>
}

// CopyRows 逐项显示一组密钥类的值，每项可以复制；空值不显示（凭据与密钥生成的结果）。
export function CopyRows({ values, label }: { values: Record<string, unknown>; label: (key: string) => string }) {
  const { t } = useTranslation()
  const copy = async (text: string) => {
    if (await copyText(text)) toast.success(t('actions.copied'))
    else toast.error(t('actions.copyFailed'))
  }
  const rows = Object.entries(values).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 sm:grid-cols-[12rem_1fr_auto] sm:items-center" data-testid={`copy-${k}`}>
          <dt className="text-muted-foreground">{label(k)}</dt>
          <dd className="font-mono text-xs break-all">{String(v)}</dd>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(String(v))}>
            {t('actions.copy')}
          </Button>
        </div>
      ))}
    </dl>
  )
}

export function LocalError({ message }: { message: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-destructive text-sm">
      {message}
    </p>
  )
}

// useProxyRefresh：主控库写入之后（成功或部分节点失败）让代理页的列表与详情都重新读取（design 第 11 条）。
// 落地规划会顺带建一条路由规则，所以路由的列表与详情也在里面（m2-20 design 第 1 条）。
export function useProxyRefresh() {
  const queryClient = useQueryClient()
  return () =>
    void Promise.all(
      ['inbound list', 'inbound get', 'inbound batch list', 'outbound list', 'outbound get', 'outbound batch list', 'routing list', 'routing get'].map((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      ),
    )
}

// ObjectOp 是删除或恢复一个入站、出站或路由规则（design 第 6 条）：恢复要带已删除对象的 resourceVersion。
export interface ObjectOp {
  op: 'delete' | 'restore'
  kind: 'Inbound' | 'Outbound' | 'RoutingRule'
  id: number
  resourceVersion: number
  label: string
}

// useObjectOp 点了才预演、只预演一次（不放进 effect，免得重新挂载时再生成一份计划），结果在对话框里照 PlanReview 提交。
export function useObjectOp(onApplied: () => void): { start: (o: ObjectOp) => void; dialog: ReactNode } {
  const { t } = useTranslation('proxy')
  const [target, setTarget] = useState<ObjectOp | null>(null)
  const preview = useMutation({
    mutationFn: (o: ObjectOp) => run<PlanView>('plan', { flags: { spec: JSON.stringify({ op: o.op, kind: o.kind, id: o.id, resourceVersion: o.resourceVersion }) } }),
  })
  const start = (o: ObjectOp) => {
    setTarget(o)
    preview.reset()
    preview.mutate(o)
  }
  const dialog = target && (
    <WideDialog title={t(`op.${target.op}Title`, { kind: t(`kinds.${target.kind}`), label: target.label, id: target.id })} onClose={() => setTarget(null)}>
      <ErrorNotice error={preview.error} />
      {preview.data && <PlanReview key={preview.data.plan_id} plan={preview.data} onApplied={onApplied} />}
    </WideDialog>
  )
  return { start, dialog }
}

// Field 是表单里的一个带标签的输入。
export function Field({ id, label, children, hint }: { id: string; label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  )
}
