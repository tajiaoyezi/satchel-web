import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run, type Verification } from '@/api/client'
import type { Page } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatTime } from '@/lib/format'

export const Route = createFileRoute('/_app/security')({ component: SecurityPage })

interface Ban {
  ip: string
  reason: string
  banned_at: string
  expires_at: string | null
  permanent: boolean
  fail_count: number
  actor: string
}

interface SecurityEvent {
  id: number
  at: string
  ip: string
  kind: string
  path: string
  username: string
  detail: string
  actor: string
}

const KINDS = ['all', 'login_fail', 'login_locked', 'verify_fail', 'verify_locked', 'probe', 'ban', 'ban_manual', 'unban'] as const

// 安全页（web-console「安全页」）：生效中的封禁与安全事件；封禁与解封是人类专属，提交前当场验证。
function SecurityPage() {
  const { t } = useTranslation('security')
  return (
    <AdminPage title={t('title')}>
      <Alert>
        <AlertDescription>{t('scope')}</AlertDescription>
      </Alert>
      <Tabs defaultValue="bans">
        <TabsList>
          <TabsTrigger value="bans">{t('tabs.bans')}</TabsTrigger>
          <TabsTrigger value="events">{t('tabs.events')}</TabsTrigger>
        </TabsList>
        <TabsContent value="bans">
          <Bans />
        </TabsContent>
        <TabsContent value="events">
          <Events />
        </TabsContent>
      </Tabs>
    </AdminPage>
  )
}

function Bans() {
  const { t } = useTranslation('security')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const [banning, setBanning] = useState(false)
  const list = useInfiniteQuery({
    queryKey: ['security bans list'],
    queryFn: ({ pageParam }) => run<Page<Ban>>('security bans list', { limit: 100, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: ['security bans list'] }), queryClient.invalidateQueries({ queryKey: ['security events list'] })])
  const unban = useMutation({
    mutationFn: ({ ip, verify }: { ip: string; verify: Verification }) => run('security unban', { args: [ip], verify }),
    onSuccess: async (_res, { ip }) => {
      await refresh()
      toast.success(t('done.unbanned', { ip }))
    },
  })
  const onUnban = async (ip: string) => {
    if (!(await dialogs.confirm({ title: t('unbanConfirm.title', { ip }), description: t('unbanConfirm.description') }))) return
    const verify = await dialogs.verify()
    if (verify) unban.mutate({ ip, verify })
  }
  return (
    <Card className="shadow-flat">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <Button onClick={() => setBanning(true)}>{t('actions.ban')}</Button>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error ?? unban.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('bans.ip')}</TableHead>
              <TableHead>{t('bans.reason')}</TableHead>
              <TableHead>{t('bans.bannedAt')}</TableHead>
              <TableHead>{t('bans.expiresAt')}</TableHead>
              <TableHead>{t('bans.failCount')}</TableHead>
              <TableHead>{t('bans.actor')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  {t('bans.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((b) => (
              <TableRow key={b.ip} data-testid={`ban-${b.ip}`}>
                <TableCell className="font-mono">{b.ip}</TableCell>
                <TableCell>{t(`reasons.${b.reason}` as 'reasons.manual', { defaultValue: b.reason })}</TableCell>
                <TableCell>{formatTime(b.banned_at)}</TableCell>
                <TableCell>{b.permanent || !b.expires_at ? t('bans.permanent') : formatTime(b.expires_at)}</TableCell>
                <TableCell>{b.fail_count}</TableCell>
                <TableCell>{b.actor}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" disabled={unban.isPending} onClick={() => void onUnban(b.ip)}>
                    {t('actions.unban')}
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
      {banning && (
        <BanForm
          onClose={() => setBanning(false)}
          onBanned={async (ip) => {
            setBanning(false)
            await refresh()
            toast.success(t('done.banned', { ip }))
          }}
        />
      )}
    </Card>
  )
}

// BanForm 是封禁一个 IP 的对话框；提交前当场验证。IP 的格式由主控判定，这里不预先检查。
function BanForm({ onClose, onBanned }: { onClose: () => void; onBanned: (ip: string) => void }) {
  const { t } = useTranslation('security')
  const dialogs = useDialogs()
  const [ip, setIp] = useState('')
  const [permanent, setPermanent] = useState(false)
  const ban = useMutation({
    mutationFn: (verify: Verification) => run('security ban', { args: [ip.trim()], flags: { permanent }, verify }),
    onSuccess: () => onBanned(ip.trim()),
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const verify = await dialogs.verify()
    if (verify) ban.mutate(verify)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t('banForm.title')}</DialogTitle>
            <DialogDescription>{t('banForm.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="ban-ip">{t('banForm.ip')}</Label>
            <Input id="ban-ip" value={ip} onChange={(e) => setIp(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={permanent} onCheckedChange={(v) => setPermanent(v === true)} />
            {t('banForm.permanent')}
          </label>
          <ErrorNotice error={ban.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={!ip.trim() || ban.isPending}>
              {t('banForm.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Events() {
  const { t } = useTranslation('security')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all')
  const [ip, setIp] = useState('')
  const [appliedIp, setAppliedIp] = useState('')
  const list = useInfiniteQuery({
    queryKey: ['security events list', kind, appliedIp],
    queryFn: ({ pageParam }) => run<Page<SecurityEvent>>('security events list', { flags: { kind: kind === 'all' ? undefined : kind, ip: appliedIp || undefined }, limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const kindLabel = (k: string) => t(`kinds.${k}` as 'kinds.ban', { defaultValue: k })
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setAppliedIp(ip.trim())
          }}
        >
          <Select value={kind} onValueChange={(v) => setKind(v as (typeof KINDS)[number])}>
            <SelectTrigger aria-label={t('events.kindFilter')} className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k === 'all' ? t('events.allKinds') : kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input className="max-w-xs" placeholder={t('events.ipFilter')} aria-label={t('events.ipFilter')} value={ip} onChange={(e) => setIp(e.target.value)} />
          <Button type="submit" variant="outline">
            {t('events.search')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('events.at')}</TableHead>
              <TableHead>{t('events.ip')}</TableHead>
              <TableHead>{t('events.kind')}</TableHead>
              <TableHead>{t('events.path')}</TableHead>
              <TableHead>{t('events.username')}</TableHead>
              <TableHead>{t('events.detail')}</TableHead>
              <TableHead>{t('events.actor')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground text-center">
                  {t('events.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((ev) => (
              <TableRow key={ev.id} data-testid={`event-${ev.id}`}>
                <TableCell>{formatTime(ev.at)}</TableCell>
                <TableCell className="font-mono">{ev.ip}</TableCell>
                <TableCell>
                  <Badge variant="outline">{kindLabel(ev.kind)}</Badge>
                </TableCell>
                <TableCell className="font-mono">{ev.path}</TableCell>
                <TableCell>{ev.username}</TableCell>
                <TableCell className="max-w-xs break-all whitespace-normal">{ev.detail}</TableCell>
                <TableCell>{ev.actor}</TableCell>
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
