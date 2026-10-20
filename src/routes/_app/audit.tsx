import { useInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/audit')({ component: AuditPage })

interface AuditRecord {
  id: number
  at: string
  actor: string
  actor_kind: string
  token_id: number | null
  command: string
  args_digest: string
  result: string
}

interface Filters {
  actor: string
  command: string
  since: string // datetime-local 的值（本地时间）
}

const empty: Filters = { actor: '', command: '', since: '' }

// 审计页（web-console「审计页」）：按时间倒序列出审计记录，按账号、命令前缀与起始时间过滤；起始时间按本地时间选，发请求时转成 RFC 3339。
function AuditPage() {
  const { t } = useTranslation('audit')
  return (
    <AdminPage title={t('title')}>
      <AuditBody />
    </AdminPage>
  )
}

function AuditBody() {
  const { t } = useTranslation('audit')
  const [form, setForm] = useState<Filters>(empty)
  const [applied, setApplied] = useState<Filters>(empty)
  const list = useInfiniteQuery({
    queryKey: ['audit list', applied],
    queryFn: ({ pageParam }) =>
      run<Page<AuditRecord>>('audit list', {
        flags: { actor: applied.actor || undefined, command: applied.command || undefined, since: applied.since ? new Date(applied.since).toISOString() : undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const search = (e: FormEvent) => {
    e.preventDefault()
    setApplied({ actor: form.actor.trim(), command: form.command.trim(), since: form.since })
  }
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('description')}</CardDescription>
        <form className="flex flex-wrap items-end gap-3" onSubmit={search}>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-actor">{t('filters.actor')}</Label>
            <Input id="audit-actor" className="w-48" value={form.actor} onChange={(e) => setForm({ ...form, actor: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-command">{t('filters.command')}</Label>
            <Input id="audit-command" className="w-48" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-since">{t('filters.since')}</Label>
            <Input id="audit-since" type="datetime-local" className="w-56" value={form.since} onChange={(e) => setForm({ ...form, since: e.target.value })} />
          </div>
          <Button type="submit" variant="outline">
            {t('filters.search')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.at')}</TableHead>
              <TableHead>{t('columns.actor')}</TableHead>
              <TableHead>{t('columns.command')}</TableHead>
              <TableHead>{t('columns.result')}</TableHead>
              <TableHead>{t('columns.args')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => (
              <AuditRow key={r.id} record={r} />
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

// pretty 把参数摘要排成缩进的 JSON；不是 JSON 时原样给。打码的值主控已经换成 ***，照原样显示。
function pretty(digest: string): string {
  try {
    return JSON.stringify(JSON.parse(digest), null, 2)
  } catch {
    return digest
  }
}

function AuditRow({ record: r }: { record: AuditRecord }) {
  const { t } = useTranslation('audit')
  const [open, setOpen] = useState(false)
  return (
    <TableRow data-testid={`audit-${r.id}`}>
      <TableCell className="align-top">{formatTime(r.at)}</TableCell>
      <TableCell className="align-top">
        <span className="flex flex-wrap items-center gap-1">
          {r.actor}
          <Badge variant="outline">{r.actor_kind}</Badge>
          {r.token_id !== null && <Badge variant="secondary">{t('token', { id: r.token_id })}</Badge>}
        </span>
      </TableCell>
      <TableCell className="align-top font-mono">{r.command}</TableCell>
      <TableCell className="align-top">
        <Badge variant={r.result === 'ok' ? 'outline' : 'destructive'}>{r.result === 'ok' ? t('ok') : r.result}</Badge>
      </TableCell>
      <TableCell className="align-top">
        <Button variant="link" size="sm" className="px-0" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? t('collapse') : t('expand')}
        </Button>
        {open && <pre className="bg-muted max-w-md overflow-x-auto rounded p-2 text-xs">{pretty(r.args_digest)}</pre>}
      </TableCell>
    </TableRow>
  )
}
