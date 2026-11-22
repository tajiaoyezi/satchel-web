import { useInfiniteQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'

import { Field, serverName, useServers } from './-shared'

// 代理页的「批次记录」（web-console「代理页」）：批量规划提交之后主控写下的批次，入站与出站各一张表。

interface BatchRow {
  id: number
  batch_id: string
  server_id: number
  tag: string
  protocol: string
  port?: number
  created_at: string
}

export function BatchesTab({ server }: { server: ServerSummary | null }) {
  return (
    <div className="grid gap-4">
      <BatchTable kind="inbound" server={server} />
      <BatchTable kind="outbound" server={server} />
    </div>
  )
}

function BatchTable({ kind, server }: { kind: 'inbound' | 'outbound'; server: ServerSummary | null }) {
  const { t } = useTranslation('proxy')
  const servers = useServers()
  const [draft, setDraft] = useState('')
  const [batchId, setBatchId] = useState('')
  const name = server?.name ?? ''
  const list = useInfiniteQuery({
    queryKey: [`${kind} batch list`, name, batchId],
    queryFn: ({ pageParam }) => {
      const opts = { flags: { 'server-name': name || undefined, 'batch-id': batchId || undefined }, limit: 50, cursor: pageParam }
      // 命令名要写成字面量：构建时的页面清单扫描按字面量核对
      return kind === 'inbound' ? run<Page<BatchRow>>('inbound batch list', opts) : run<Page<BatchRow>>('outbound batch list', opts)
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const search = (e: FormEvent) => {
    e.preventDefault()
    setBatchId(draft.trim())
  }
  const id = `${kind}-batch-id`
  return (
    <Card className="shadow-flat" data-testid={`${kind}-batches`}>
      <CardHeader className="grid gap-3">
        <CardTitle>{t(`batches.${kind}Title` as 'batches.inboundTitle')}</CardTitle>
        <form className="flex items-end gap-2" onSubmit={search}>
          <Field id={id} label={t('batches.batchId')}>
            <Input id={id} className="w-64" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <Button type="submit" variant="outline">
            {t('search')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cols.id')}</TableHead>
              <TableHead>{t('batches.batchId')}</TableHead>
              <TableHead>{t('cols.server')}</TableHead>
              <TableHead>{t('cols.tag')}</TableHead>
              <TableHead>{t('cols.protocol')}</TableHead>
              {kind === 'inbound' && <TableHead>{t('cols.port')}</TableHead>}
              <TableHead>{t('batches.createdAt')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  {t('batches.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.id}</TableCell>
                <TableCell className="font-mono text-xs">{r.batch_id}</TableCell>
                <TableCell>{serverName(servers, r.server_id)}</TableCell>
                <TableCell className="font-mono">{r.tag}</TableCell>
                <TableCell>{r.protocol}</TableCell>
                {kind === 'inbound' && <TableCell className="tabular-nums">{r.port}</TableCell>}
                <TableCell>{formatTime(r.created_at)}</TableCell>
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
    </Card>
  )
}
