import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatBytes, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_app/logs')({ component: LogsPage })

interface LogFile {
  name: string
  size: number
  modified: string
  active: boolean
}

// LogLine 是 logs list 的一行：拆开的 time、level、msg 与其余键值；拆不开时只有 raw。
interface LogLine {
  time?: string
  level?: string
  msg?: string
  attrs?: Record<string, string>
  raw?: string
}

const LEVELS = ['all', 'debug', 'info', 'warn', 'error'] as const

// 日志页（web-console「日志页」）：左边选文件，右边按级别与文本过滤，从新到旧翻页；不自动刷新。
function LogsPage() {
  const { t } = useTranslation('logs')
  return (
    <AdminPage title={t('title')}>
      <LogsBody />
    </AdminPage>
  )
}

function LogsBody() {
  const { t } = useTranslation('logs')
  const queryClient = useQueryClient()
  const [file, setFile] = useState('') // 空是当前文件
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('all')
  const [grep, setGrep] = useState('')
  const [applied, setApplied] = useState('') // 文本按回车或「查询」才生效，不是每敲一个字发一次请求
  const files = useQuery({ queryKey: ['logs files list'], queryFn: () => run<Page<LogFile>>('logs files list', { limit: 100 }) })
  const lines = useInfiniteQuery({
    queryKey: ['logs list', file, level, applied],
    queryFn: ({ pageParam }) =>
      run<Page<LogLine>>('logs list', { flags: { file: file || undefined, level: level === 'all' ? undefined : level, grep: applied || undefined }, limit: 200, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = lines.data?.pages.flatMap((p) => p.items) ?? []
  const total = lines.data?.pages[0]?.total ?? 0
  const search = (e: FormEvent) => {
    e.preventDefault()
    setApplied(grep)
  }
  const refresh = () => {
    void queryClient.resetQueries({ queryKey: ['logs list'] })
    void files.refetch()
  }
  return (
    <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
      <Card className="shadow-flat self-start">
        <CardHeader>
          <CardTitle>{t('files.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1">
          <ErrorNotice error={files.error} />
          {files.data?.items.length === 0 && <p className="text-muted-foreground text-sm">{t('files.empty')}</p>}
          {files.data?.items.map((f) => {
            const selected = file === '' ? f.active : file === f.name
            return (
              <button
                key={f.name}
                type="button"
                aria-pressed={selected}
                className={cn('hover:bg-accent grid rounded px-2 py-1.5 text-left text-sm', selected && 'bg-accent')}
                onClick={() => setFile(f.active ? '' : f.name)}
              >
                <span className="flex items-center gap-2 font-mono break-all">
                  {f.name}
                  {f.active && <Badge variant="outline">{t('files.active')}</Badge>}
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatBytes(f.size)} · {formatTime(f.modified)}
                </span>
              </button>
            )
          })}
        </CardContent>
      </Card>
      <Card className="shadow-flat min-w-0">
        <CardHeader className="grid gap-3">
          <form className="flex flex-wrap items-center gap-2" onSubmit={search}>
            <Select value={level} onValueChange={(v) => setLevel(v as (typeof LEVELS)[number])}>
              <SelectTrigger aria-label={t('level')} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`levels.${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input className="max-w-xs" placeholder={t('grep')} aria-label={t('grep')} value={grep} onChange={(e) => setGrep(e.target.value)} />
            <Button type="submit" variant="outline">
              {t('search')}
            </Button>
            <Button type="button" variant="outline" onClick={refresh}>
              {t('refresh')}
            </Button>
          </form>
          <p className="text-muted-foreground text-sm">
            {t('total', { total })} {t('limitNote')}
          </p>
        </CardHeader>
        <CardContent className="grid gap-3">
          <ErrorNotice error={lines.error} />
          <div className="grid gap-0.5 overflow-x-auto font-mono text-xs" data-testid="log-lines">
            {items.length === 0 && !lines.isPending && <p className="text-muted-foreground font-sans text-sm">{t('empty')}</p>}
            {items.map((l, i) => (
              <LineView key={i} line={l} />
            ))}
          </div>
          {lines.hasNextPage && (
            <Button variant="outline" className="justify-self-center" onClick={() => void lines.fetchNextPage()}>
              {t('loadMore')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const LEVEL_CLASS: Record<string, string> = { ERROR: 'text-destructive', WARN: 'text-amber-600 dark:text-amber-400', DEBUG: 'text-muted-foreground' }

function LineView({ line }: { line: LogLine }) {
  if (line.msg === undefined) return <p className="whitespace-pre-wrap break-all">{line.raw}</p>
  const level = (line.level ?? '').toUpperCase()
  return (
    <p className="whitespace-pre-wrap break-all" data-level={level}>
      <span className="text-muted-foreground">{formatTime(line.time)}</span> <span className={cn('font-semibold', LEVEL_CLASS[level])}>{level}</span> <span>{line.msg}</span>
      {line.attrs && (
        <span className="text-muted-foreground">
          {' '}
          {Object.entries(line.attrs)
            .map(([k, v]) => `${k}=${v}`)
            .join(' ')}
        </span>
      )}
    </p>
  )
}
