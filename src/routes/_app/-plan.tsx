import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, run } from '@/api/client'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { lineDiff } from '@/lib/diff'
import { formatTime } from '@/lib/format'

// 配置的预演与提交（web-console「配置的预演与提交」，m2-16 design 第 2 条）：调用方各自调 plan、snapshot rollback 或
// plans get 拿到计划，这里只管展示与提交。需要危险类时先弹危险确认，确认值是主控给的 confirm_hint；不提供 force。
// onApplied 在主控库已经写入时调用：成功，以及部分节点失败（partial_failure，结果取自错误的 state）。

export interface FieldChange {
  before: unknown
  after: unknown
}

export interface PlannedObject {
  op: string
  kind: string
  id?: number
  name: string
  field_diff?: Record<string, FieldChange>
  dangers?: string[]
}

export interface ServerConfigDiff {
  server_id: number
  server_name: string
  expected_current_hash: string
  next_hash: string
  config_changed: boolean
  first_apply_eligible: boolean
  inbounds: string[] | null
  before_config?: string
  after_config?: string
}

export interface PlanView {
  plan_id: number
  status: string
  affected_count: number
  expires_at: string
  created_at: string
  required_dangers: string[] | null
  confirm_hint?: string
  batch_window?: { used: number; affected: number; single_threshold: number; window_threshold: number; window_minutes: number }
  objects: PlannedObject[] | null
  servers: ServerConfigDiff[] | null
  skipped?: SkippedObject[]
}

export interface SkippedObject {
  snapshot_id: number
  kind: string
  id: number
  reason: string
}

// SkippedList 列出回滚时跳过的对象与原因：回滚计划里有，回滚目标全部被跳过时主控回 conflict、放在 state.skipped 里。
export function SkippedList({ skipped }: { skipped: SkippedObject[] }) {
  const { t } = useTranslation('changes')
  if (skipped.length === 0) return null
  return (
    <section className="grid gap-1 text-sm" data-testid="plan-skipped">
      <h3 className="font-medium">{t('plan.skipped')}</h3>
      {skipped.map((s) => (
        <p key={`${s.kind}-${s.id}-${s.snapshot_id}`}>{t('plan.skippedItem', { kind: s.kind, id: s.id, reason: s.reason })}</p>
      ))}
    </section>
  )
}

export interface ServerApplyResult {
  server_id: number
  server_name: string
  status: string // applied | unchanged | failed
  applied_hash?: string
  error?: string
  rolled_back?: boolean
  rollback_error?: string
}

export interface AppliedObject {
  op: string
  kind: string
  id: number
  name: string
  resourceVersion: number
}

export interface ApplyResult {
  plan_id: number
  apply_id: string
  affected_count: number
  objects: AppliedObject[] | null
  servers: ServerApplyResult[] | null
}

const short = (hash: string) => (hash ? hash.slice(0, 12) : '-')

// value 把字段的前后值写成一行字：字符串原样，空值写明，对象与数组按 JSON。
function Value({ v }: { v: unknown }) {
  const { t } = useTranslation('changes')
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">{t('plan.empty')}</span>
  if (typeof v === 'string') return <span className="break-all">{v}</span>
  return <code className="font-mono text-xs break-all whitespace-pre-wrap">{JSON.stringify(v, null, 2)}</code>
}

export function PlanReview({ plan, onApplied }: { plan: PlanView; onApplied?: (result: ApplyResult) => void }) {
  const { t } = useTranslation('changes')
  const dialogs = useDialogs()
  const dangers = plan.required_dangers ?? []
  const apply = useMutation({
    mutationFn: (confirm: string | undefined) => run<ApplyResult>('apply', { flags: { plan: plan.plan_id }, confirm }),
    onSuccess: (r) => onApplied?.(r),
    onError: (e) => {
      if (!(e instanceof ApiError) || e.code !== 'partial_failure') return
      const st = e.body.state
      onApplied?.({
        plan_id: plan.plan_id,
        apply_id: String(st.apply_id ?? ''),
        affected_count: plan.affected_count,
        objects: (st.objects as AppliedObject[] | undefined) ?? [],
        servers: (st.results as ServerApplyResult[] | undefined) ?? [],
      })
    },
  })
  const submit = async () => {
    if (dangers.length === 0) return apply.mutate(undefined)
    const names = dangers.map((d) => t(`dangers.${d}` as 'dangers.delete', { ns: 'tokens', defaultValue: d })).join('、')
    const ok = await dialogs.confirm({ title: t('plan.confirmTitle', { dangers: names }), description: t('plan.confirmDescription'), value: plan.confirm_hint ?? '', destructive: true })
    if (ok) apply.mutate(plan.confirm_hint)
  }
  const partial = apply.error instanceof ApiError && apply.error.code === 'partial_failure' ? apply.error : null
  const bw = plan.batch_window
  return (
    <div className="grid gap-4 text-sm" data-testid="plan-review">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        <dt className="text-muted-foreground">{t('plan.id')}</dt>
        <dd className="font-mono">{plan.plan_id}</dd>
        <dt className="text-muted-foreground">{t('plan.status')}</dt>
        <dd>
          <Badge variant="outline">{t(`plan.statuses.${plan.status}` as 'plan.statuses.pending', { defaultValue: plan.status })}</Badge>
        </dd>
        <dt className="text-muted-foreground">{t('plan.affected')}</dt>
        <dd>{plan.affected_count}</dd>
        <dt className="text-muted-foreground">{t('plan.expiresAt')}</dt>
        <dd>{formatTime(plan.expires_at)}</dd>
        <dt className="text-muted-foreground">{t('plan.dangers')}</dt>
        <dd data-testid="plan-dangers">{dangers.length ? dangers.map((d) => t(`dangers.${d}` as 'dangers.delete', { ns: 'tokens', defaultValue: d })).join('、') : t('plan.noDangers')}</dd>
        {plan.confirm_hint && (
          <>
            <dt className="text-muted-foreground">{t('plan.confirmHint')}</dt>
            <dd className="font-mono">{plan.confirm_hint}</dd>
          </>
        )}
        {bw && (
          <>
            <dt className="text-muted-foreground">{t('plan.batchWindow')}</dt>
            <dd>{t('plan.batchWindowValue', { used: bw.used, affected: bw.affected, single: bw.single_threshold, window: bw.window_threshold, minutes: bw.window_minutes })}</dd>
          </>
        )}
      </dl>

      <section className="grid gap-2">
        <h3 className="font-medium">{t('plan.objects')}</h3>
        {(plan.objects ?? []).map((o, i) => (
          <div key={`${o.kind}-${o.id ?? i}-${o.op}`} className="grid gap-2 rounded-md border p-3" data-testid={`plan-object-${o.name}`}>
            <p className="flex flex-wrap items-center gap-2">
              <Badge>{t(`plan.ops.${o.op}` as 'plan.ops.update', { defaultValue: o.op })}</Badge>
              <span className="text-muted-foreground">{o.kind}</span>
              <span className="font-mono">{o.name}</span>
              {o.id ? <span className="text-muted-foreground">#{o.id}</span> : null}
            </p>
            {o.field_diff && Object.keys(o.field_diff).length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('plan.field')}</TableHead>
                    <TableHead>{t('plan.before')}</TableHead>
                    <TableHead>{t('plan.after')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(o.field_diff).map(([field, c]) => (
                    <TableRow key={field} data-testid={`plan-field-${field}`}>
                      <TableCell className="font-mono align-top">{field}</TableCell>
                      <TableCell className="align-top">
                        <Value v={c.before} />
                      </TableCell>
                      <TableCell className="align-top">
                        <Value v={c.after} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        ))}
      </section>

      {(plan.servers ?? []).length > 0 && (
        <section className="grid gap-2">
          <h3 className="font-medium">{t('plan.servers')}</h3>
          {(plan.servers ?? []).map((s) => (
            <ServerDiff key={s.server_id} diff={s} />
          ))}
        </section>
      )}

      <SkippedList skipped={plan.skipped ?? []} />

      {/* 主控库已经写入（成功或部分节点失败）后，这份计划已经提交过，不再显示「提交」 */}
      {plan.status === 'pending' && !apply.data && !partial && (
        <div>
          <Button disabled={apply.isPending} onClick={() => void submit()}>
            {t('plan.submit')}
          </Button>
        </div>
      )}
      {apply.data && (
        <Alert data-testid="apply-result">
          <AlertTitle>{t('plan.applied', { applyId: apply.data.apply_id })}</AlertTitle>
          <AlertDescription>
            <ServerResults results={apply.data.servers ?? []} />
          </AlertDescription>
        </Alert>
      )}
      {partial ? (
        <Alert variant="destructive" role="alert" data-testid="apply-partial">
          <AlertTitle>{t('plan.partialTitle')}</AlertTitle>
          <AlertDescription className="grid gap-2">
            <p>{partial.body.reason}</p>
            <ServerResults results={(partial.body.state.results as ServerApplyResult[] | undefined) ?? []} />
          </AlertDescription>
        </Alert>
      ) : (
        apply.error && (
          <div className="grid gap-1">
            <ErrorNotice error={apply.error} />
            <p className="text-muted-foreground">{t('plan.replan')}</p>
          </div>
        )
      )}
    </div>
  )
}

function ServerDiff({ diff: s }: { diff: ServerConfigDiff }) {
  const { t } = useTranslation('changes')
  const [open, setOpen] = useState(false)
  return (
    <div className="grid gap-2 rounded-md border p-3" data-testid={`plan-server-${s.server_name}`}>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{s.server_name}</span>
        <Badge variant={s.config_changed ? 'default' : 'outline'}>{s.config_changed ? t('plan.configChanged') : t('plan.configSame')}</Badge>
        {s.first_apply_eligible && <Badge variant="secondary">{t('plan.firstApply')}</Badge>}
      </p>
      <p className="text-muted-foreground font-mono text-xs">{t('plan.hashes', { from: short(s.expected_current_hash), to: short(s.next_hash) })}</p>
      {s.inbounds && s.inbounds.length > 0 && <p>{t('plan.inbounds', { inbounds: s.inbounds.join(', ') })}</p>}
      {(s.before_config !== undefined || s.after_config !== undefined) && (
        <div>
          <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? t('plan.hideConfig') : t('plan.showConfig')}
          </Button>
        </div>
      )}
      {open && <ConfigDiff before={s.before_config ?? ''} after={s.after_config ?? ''} />}
    </div>
  )
}

// ConfigDiff 按行显示 kernel.json 的前后对比；行数太多时不对齐，前后两段并排原样显示。
function ConfigDiff({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation('changes')
  const lines = lineDiff(before, after)
  if (!lines) {
    return (
      <div className="grid gap-2 md:grid-cols-2" data-testid="config-diff-raw">
        <p className="text-muted-foreground md:col-span-2">{t('plan.diffTooLarge')}</p>
        <pre className="bg-muted max-h-96 overflow-auto rounded p-2 font-mono text-xs">{before}</pre>
        <pre className="bg-muted max-h-96 overflow-auto rounded p-2 font-mono text-xs">{after}</pre>
      </div>
    )
  }
  return (
    <pre className="bg-muted max-h-96 overflow-auto rounded p-2 font-mono text-xs" data-testid="config-diff">
      {lines.map((l, i) => (
        <div
          key={i}
          data-diff={l.type}
          className={l.type === 'add' ? 'bg-green-500/15 text-green-700 dark:text-green-400' : l.type === 'del' ? 'bg-red-500/15 text-red-700 dark:text-red-400' : undefined}
        >
          {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
          {l.text}
        </div>
      ))}
    </pre>
  )
}

function ServerResults({ results }: { results: ServerApplyResult[] }) {
  const { t } = useTranslation('changes')
  if (results.length === 0) return <p>{t('plan.noServers')}</p>
  return (
    <Table data-testid="apply-servers">
      <TableHeader>
        <TableRow>
          <TableHead>{t('plan.server')}</TableHead>
          <TableHead>{t('plan.result')}</TableHead>
          <TableHead>{t('plan.detail')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.server_id} data-testid={`apply-server-${r.server_name}`}>
            <TableCell className="font-mono">{r.server_name}</TableCell>
            <TableCell>{t(`plan.results.${r.status}` as 'plan.results.applied', { defaultValue: r.status })}</TableCell>
            <TableCell className="break-all">
              {r.status === 'applied' && r.applied_hash ? <span className="font-mono text-xs">{short(r.applied_hash)}</span> : null}
              {r.error ? <span>{r.error}</span> : null}
              {r.rolled_back ? <span>{t('plan.rolledBack')}</span> : null}
              {r.rollback_error ? <span>{t('plan.rollbackError', { error: r.rollback_error })}</span> : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
