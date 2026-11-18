import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { ServerStatusBadge, type ServerObject, type ServerSummary } from '@/components/ServerStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/servers/')({ component: ServersPage })

// REFRESH_MS 是列表的自动刷新间隔（design 第 3 条）；PAGE_LIMIT 是主控允许的单页上限（design 第 4 条）。
const REFRESH_MS = 10_000
const PAGE_LIMIT = 500

// 服务器列表页（web-console「服务器页」）。
function ServersPage() {
  const { t } = useTranslation('servers')
  return (
    <AdminPage title={t('title')}>
      <ServerList />
    </AdminPage>
  )
}

function ServerList() {
  const { t } = useTranslation('servers')
  const [adding, setAdding] = useState(false)
  const list = useInfiniteQuery({
    queryKey: ['server list'],
    queryFn: ({ pageParam }) => run<Page<ServerSummary>>('server list', { limit: PAGE_LIMIT, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    refetchInterval: REFRESH_MS,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0
  const count = (status: string) => items.filter((s) => s.status === status).length
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAdding(true)}>{t('actions.add')}</Button>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="outline" data-testid="count-online">
            {t('list.online', { count: count('connected') })}
          </Badge>
          <Badge variant="outline" data-testid="count-offline">
            {t('list.offline', { count: count('offline') })}
          </Badge>
          <span className="text-muted-foreground">{t('list.total', { count: total })}</span>
          {list.hasNextPage && <span className="text-muted-foreground">{t('list.partial')}</span>}
        </div>
      </div>
      <ErrorNotice error={list.error} />
      {items.length === 0 && list.isSuccess && <p className="text-muted-foreground text-sm">{t('list.empty')}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((s) => (
          <ServerCard key={s.id} server={s} />
        ))}
      </div>
      {list.hasNextPage && (
        <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
          {t('list.loadMore')}
        </Button>
      )}
      {adding && <AddServerDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

function ServerCard({ server: s }: { server: ServerSummary }) {
  const { t } = useTranslation('servers')
  const none = t('fields.none')
  return (
    <Link to="/servers/$name" params={{ name: s.name }} data-testid={`server-${s.name}`} className="rounded-xl">
      <Card className="shadow-flat hover:bg-accent/40 h-full transition-colors">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="truncate">{s.name}</CardTitle>
          <ServerStatusBadge status={s.status} />
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{t('fields.mode')}</dt>
            <dd>{s.connection_mode}</dd>
            <dt className="text-muted-foreground">{t('fields.ipv4')}</dt>
            <dd className="font-mono">{s.ip_address || none}</dd>
            <dt className="text-muted-foreground">{t('fields.ipv6')}</dt>
            <dd className="font-mono break-all">{s.ip_address_v6 || none}</dd>
            <dt className="text-muted-foreground">{t('fields.lastHeartbeat')}</dt>
            <dd>{s.last_heartbeat ? formatTime(s.last_heartbeat) : t('fields.noHeartbeat')}</dd>
          </dl>
        </CardContent>
      </Card>
    </Link>
  )
}

// MODES 是 server add 的四种连接模式（m2-06）；ADDR 是非 websocket 模式下可选的六个寻址参数（flag 名），分管理入口与轮询两组。
const MODES = ['auto', 'websocket', 'http', 'pull'] as const
type Mode = (typeof MODES)[number]
const ADDR_GROUPS = [
  { key: 'manage', fields: ['domain', 'domain-v6', 'listen-port'] },
  { key: 'pull', fields: ['pull-address', 'pull-address-v6', 'pull-port'] },
] as const
type AddrField = (typeof ADDR_GROUPS)[number]['fields'][number]
const PORTS: ReadonlySet<AddrField> = new Set(['listen-port', 'pull-port'])
const EMPTY_ADDR: Record<AddrField, string> = { domain: '', 'domain-v6': '', 'listen-port': '', 'pull-address': '', 'pull-address-v6': '', 'pull-port': '' }

// AddServerDialog：名字、连接模式，非 websocket 时加六个可选的寻址参数（design 第 1、2 条）。每种模式要哪些参数由主控判定，
// 这里只把填了的发出去：去掉首尾空格，空的不发，端口按数字发。
function AddServerDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('servers')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Mode>('auto')
  const [addr, setAddr] = useState(EMPTY_ADDR)
  const flags = () => {
    const f: Record<string, string | number> = { mode }
    if (mode === 'websocket') return f
    for (const [k, v] of Object.entries(addr) as [AddrField, string][]) {
      const value = v.trim()
      if (value) f[k] = PORTS.has(k) ? Number(value) : value
    }
    return f
  }
  const add = useMutation({
    mutationFn: () => run<ServerObject>('server add', { args: [name.trim()], flags: flags() }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['server list'] })
      await navigate({ to: '/servers/$name', params: { name: res.spec?.name || name.trim() } })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    add.mutate()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form className="grid gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t('add.title')}</DialogTitle>
            <DialogDescription>{t('add.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="server-name">{t('add.name')}</Label>
            <Input id="server-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="server-mode">{t('add.mode')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger id="server-mode" aria-label={t('add.mode')} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">{t(`add.modes.${mode}`)}</p>
          </div>
          {mode !== 'websocket' &&
            ADDR_GROUPS.map((g) => (
              <fieldset key={g.key} className="grid gap-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">{t(`add.groups.${g.key}`)}</legend>
                <p className="text-muted-foreground text-sm">{t(`add.groupHints.${g.key}`)}</p>
                {g.fields.map((f) => (
                  <div key={f} className="grid gap-1.5">
                    <Label htmlFor={`server-${f}`}>{t(`add.fields.${f}`)}</Label>
                    <Input
                      id={`server-${f}`}
                      type={PORTS.has(f) ? 'number' : 'text'}
                      inputMode={PORTS.has(f) ? 'numeric' : undefined}
                      placeholder={PORTS.has(f) ? t(`add.portHints.${f as 'listen-port' | 'pull-port'}`) : undefined}
                      value={addr[f]}
                      onChange={(e) => setAddr((prev) => ({ ...prev, [f]: e.target.value }))}
                    />
                  </div>
                ))}
              </fieldset>
            ))}
          <ErrorNotice error={add.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={!name.trim() || add.isPending}>
              {t('add.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
