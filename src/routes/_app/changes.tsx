import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ApiError, run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatTime } from '@/lib/format'

import { PlanReview, SkippedList, type PlanView, type SkippedObject } from './-plan'

export const Route = createFileRoute('/_app/changes')({ component: ChangesPage })

interface PlanSummary {
  id: number
  status: string
  affected_count: number
  apply_id?: string
  expires_at: string
  created_at: string
}

interface SnapshotSummary {
  id: number
  object_kind: string
  object_id: number
  object_version: number
  source: string
  apply_id?: string
  created_at: string
}

interface Snapshot extends SnapshotSummary {
  content: unknown
}

const PLAN_STATUSES = ['all', 'pending', 'applied', 'expired', 'rejected'] as const
const KINDS = ['all', 'Server', 'Inbound', 'Outbound', 'RoutingRule'] as const

// 配置变更页（web-console「配置变更页」，m2-16 design 第 8 条）：计划与快照。计划详情、按 JSON 新建计划、快照内容与回滚计划都在对话框里。
function ChangesPage() {
  const { t } = useTranslation('changes')
  return (
    <AdminPage title={t('title')}>
      <Tabs defaultValue="plans">
        <TabsList>
          <TabsTrigger value="plans">{t('tabs.plans')}</TabsTrigger>
          <TabsTrigger value="snapshots">{t('tabs.snapshots')}</TabsTrigger>
        </TabsList>
        <TabsContent value="plans">
          <Plans />
        </TabsContent>
        <TabsContent value="snapshots">
          <Snapshots />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

function Plans() {
  const { t } = useTranslation('changes')
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<(typeof PLAN_STATUSES)[number]>('all')
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const list = useInfiniteQuery({
    queryKey: ['plans list', status],
    queryFn: ({ pageParam }) => run<Page<PlanSummary>>('plans list', { flags: { status: status === 'all' ? undefined : status }, limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plans list'] })
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('plans.description')}</CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as (typeof PLAN_STATUSES)[number])}>
            <SelectTrigger aria-label={t('plans.statusFilter')} className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'all' ? t('plans.allStatuses') : t(`plan.statuses.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreating(true)}>{t('plans.create')}</Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('plans.id')}</TableHead>
              <TableHead>{t('plans.status')}</TableHead>
              <TableHead>{t('plans.affected')}</TableHead>
              <TableHead>{t('plans.createdAt')}</TableHead>
              <TableHead>{t('plans.expiresAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {t('plans.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((p) => (
              <TableRow key={p.id} data-testid={`plan-row-${p.id}`}>
                <TableCell className="font-mono">{p.id}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`plan.statuses.${p.status}` as 'plan.statuses.pending', { defaultValue: p.status })}</Badge>
                </TableCell>
                <TableCell>{p.affected_count}</TableCell>
                <TableCell>{formatTime(p.created_at)}</TableCell>
                <TableCell>{formatTime(p.expires_at)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(p.id)}>
                    {t('plans.view')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
      {open !== null && <PlanDialog id={open} onClose={() => setOpen(null)} onApplied={() => void refresh()} />}
      {creating && <NewPlanDialog onClose={() => setCreating(false)} onApplied={() => void refresh()} />}
    </Card>
  )
}

function WideDialog({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function PlanDialog({ id, onClose, onApplied }: { id: number; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('changes')
  const plan = useQuery({ queryKey: ['plans get', id], queryFn: () => run<PlanView>('plans get', { args: [String(id)] }), gcTime: 0 })
  return (
    <WideDialog title={t('plans.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={plan.error} />
      {plan.data && <PlanReview plan={plan.data} onApplied={onApplied} />}
    </WideDialog>
  )
}

// NewPlanDialog：JSON 解析不了时提示、不发请求（CLI 读文件时也在本地解析）；解析得了就把原文作为 spec 发给 plan。
function NewPlanDialog({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('changes')
  const [text, setText] = useState('')
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (spec: string) => run<PlanView>('plan', { flags: { spec } }) })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return setLocalError(t('plans.badJson'))
    }
    if (!parsed || typeof parsed !== 'object') return setLocalError(t('plans.badJson'))
    setLocalError('')
    preview.mutate(text)
  }
  return (
    <WideDialog title={t('plans.createTitle')} description={t('plans.createDescription')} onClose={onClose}>
      <form className="grid gap-3" onSubmit={submit}>
        <Label htmlFor="new-plan-spec">{t('plans.spec')}</Label>
        <Textarea id="new-plan-spec" className="min-h-40 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        {localError && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{localError}</AlertDescription>
          </Alert>
        )}
        <ErrorNotice error={preview.error} />
        <div>
          <Button type="submit" disabled={!text.trim() || preview.isPending}>
            {t('plans.preview')}
          </Button>
        </div>
      </form>
      {preview.data && <PlanReview key={preview.data.plan_id} plan={preview.data} onApplied={onApplied} />}
    </WideDialog>
  )
}

interface SnapshotFilter {
  kind: (typeof KINDS)[number]
  objectId: string
  applyId: string
}

const EMPTY_FILTER: SnapshotFilter = { kind: 'all', objectId: '', applyId: '' }

function Snapshots() {
  const { t } = useTranslation('changes')
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<SnapshotFilter>(EMPTY_FILTER)
  const [filter, setFilter] = useState<SnapshotFilter>(EMPTY_FILTER)
  const [viewing, setViewing] = useState<number | null>(null)
  const [rollback, setRollback] = useState<RollbackTarget | null>(null)
  // 回滚会在主控上生成一份新计划：点了才发、只发一次（不用 useQuery，免得重新挂载时再生成一份）
  const rb = useMutation({
    mutationFn: (target: RollbackTarget) => run<PlanView>('snapshot rollback', { flags: target.id !== undefined ? { id: target.id } : { 'apply-id': target.applyId } }),
  })
  const startRollback = (target: RollbackTarget) => {
    setRollback(target)
    rb.reset()
    rb.mutate(target)
  }
  const list = useInfiniteQuery({
    queryKey: ['snapshot list', filter],
    queryFn: ({ pageParam }) =>
      run<Page<SnapshotSummary>>('snapshot list', {
        flags: { kind: filter.kind === 'all' ? undefined : filter.kind, 'object-id': filter.objectId.trim() || undefined, 'apply-id': filter.applyId.trim() || undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFilter(draft)
  }
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('snapshots.description')}</CardDescription>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="snap-kind">{t('snapshots.kind')}</Label>
            <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as SnapshotFilter['kind'] })}>
              <SelectTrigger id="snap-kind" aria-label={t('snapshots.kind')} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k === 'all' ? t('snapshots.allKinds') : k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="snap-object">{t('snapshots.objectId')}</Label>
            <Input id="snap-object" className="w-28" inputMode="numeric" value={draft.objectId} onChange={(e) => setDraft({ ...draft, objectId: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="snap-apply">{t('snapshots.applyId')}</Label>
            <Input id="snap-apply" className="w-56" value={draft.applyId} onChange={(e) => setDraft({ ...draft, applyId: e.target.value })} />
          </div>
          <Button type="submit" variant="outline">
            {t('snapshots.search')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('snapshots.id')}</TableHead>
              <TableHead>{t('snapshots.kind')}</TableHead>
              <TableHead>{t('snapshots.objectId')}</TableHead>
              <TableHead>{t('snapshots.version')}</TableHead>
              <TableHead>{t('snapshots.source')}</TableHead>
              <TableHead>{t('snapshots.applyId')}</TableHead>
              <TableHead>{t('snapshots.createdAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground text-center">
                  {t('snapshots.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((s) => (
              <TableRow key={s.id} data-testid={`snapshot-row-${s.id}`}>
                <TableCell className="font-mono">{s.id}</TableCell>
                <TableCell>{s.object_kind}</TableCell>
                <TableCell className="font-mono">{s.object_id}</TableCell>
                <TableCell>{s.object_version}</TableCell>
                <TableCell>{s.source}</TableCell>
                <TableCell className="font-mono text-xs">{s.apply_id ?? ''}</TableCell>
                <TableCell>{formatTime(s.created_at)}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setViewing(s.id)}>
                    {t('snapshots.view')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startRollback({ id: s.id })}>
                    {t('snapshots.rollback')}
                  </Button>
                  {s.apply_id && (
                    <Button size="sm" variant="ghost" onClick={() => startRollback({ applyId: s.apply_id })}>
                      {t('snapshots.rollbackBatch')}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
      {viewing !== null && <SnapshotDialog id={viewing} onClose={() => setViewing(null)} />}
      {rollback && (
        <RollbackDialog
          target={rollback}
          error={rb.error}
          plan={rb.data}
          onClose={() => setRollback(null)}
          onApplied={() => void Promise.all([queryClient.invalidateQueries({ queryKey: ['snapshot list'] }), queryClient.invalidateQueries({ queryKey: ['plans list'] })])}
        />
      )}
    </Card>
  )
}

function SnapshotDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation('changes')
  const snap = useQuery({ queryKey: ['snapshot get', id], queryFn: () => run<Snapshot>('snapshot get', { args: [String(id)] }), gcTime: 0 })
  const s = snap.data
  return (
    <WideDialog title={t('snapshots.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={snap.error} />
      {s && (
        <div className="grid gap-2 text-sm" data-testid="snapshot-content">
          <p>{t('snapshots.detailMeta', { kind: s.object_kind, objectId: s.object_id, version: s.object_version, source: s.source })}</p>
          <pre className="bg-muted max-h-[60vh] overflow-auto rounded-md p-3 font-mono text-xs">{JSON.stringify(s.content, null, 2)}</pre>
        </div>
      )}
    </WideDialog>
  )
}

interface RollbackTarget {
  id?: number
  applyId?: string
}

// RollbackDialog：按单条快照（id）或整个 apply 批次（apply-id）生成的回滚计划，照「配置的预演与提交」显示并提交。
function RollbackDialog(props: { target: RollbackTarget; error: unknown; plan: PlanView | undefined; onClose: () => void; onApplied: () => void }) {
  const { target, error, plan, onClose, onApplied } = props
  const { t } = useTranslation('changes')
  return (
    <WideDialog
      title={target.id !== undefined ? t('snapshots.rollbackTitle', { id: target.id }) : t('snapshots.rollbackBatchTitle', { applyId: target.applyId ?? '' })}
      description={t('snapshots.rollbackNote')}
      onClose={onClose}
    >
      <ErrorNotice error={error} />
      {/* 回滚目标全部被跳过时，主控回 conflict，跳过的对象与原因在 state.skipped 里 */}
      {error instanceof ApiError && Array.isArray(error.body.state.skipped) && <SkippedList skipped={error.body.state.skipped as SkippedObject[]} />}
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}
