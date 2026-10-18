import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run, type FlagValue, type Verification } from '@/api/client'
import { accountQuery } from '@/api/queries'
import type { Page } from '@/api/types'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_app/tokens')({ component: TokensPage })

export interface Token {
  id: number
  name: string
  owner: string
  preset: string
  scopes: string[]
  danger: string[]
  runtime: string
  expires_at: string | null
  last_used_at: string | null
  created_at: string
  revoked_at: string | null
  state: string
}

const DANGERS = ['delete', 'restart', 'permission', 'batch', 'exec', 'master'] as const
type ScopeMode = 'readonly' | 'ops' | 'full' | 'custom'

const time = (v: string | null) => (v ? new Date(v).toLocaleString() : '')

// API 令牌页（web-console「API 令牌页」）：签发、改、吊销都是人类专属命令，要当场验证；新令牌的明文只显示一次。
function TokensPage() {
  const { t } = useTranslation('tokens')
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <Tabs defaultValue="tokens">
        <TabsList>
          <TabsTrigger value="tokens">{t('tabs.tokens')}</TabsTrigger>
          <TabsTrigger value="connections">{t('tabs.connections')}</TabsTrigger>
        </TabsList>
        <TabsContent value="tokens" className="grid gap-4">
          <TokenList />
          <McpHelp />
        </TabsContent>
        <TabsContent value="connections">
          <Connections />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TokenList() {
  const { t } = useTranslation('tokens')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const isAdmin = useQuery(accountQuery).data?.role === 'admin'
  const [owner, setOwner] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Token | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const list = useInfiniteQuery({
    queryKey: ['token list', owner],
    queryFn: ({ pageParam }) => run<Page<Token>>('token list', { flags: { owner: owner || undefined }, limit: 100, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const tokens = list.data?.pages.flatMap((p) => p.items) ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['token list'] })
  const revoke = useMutation({
    mutationFn: ({ id, verify }: { id: number; verify: Verification }) => run('token revoke', { args: [String(id)], verify }),
    onSuccess: refresh,
  })
  const onRevoke = async (tok: Token) => {
    if (!(await dialogs.confirm({ title: t('revokeConfirm.title', { name: tok.name }), description: t('revokeConfirm.description'), destructive: true }))) return
    const verify = await dialogs.verify()
    if (verify) revoke.mutate({ id: tok.id, verify })
  }
  return (
    <Card className="shadow-flat">
      <CardHeader className="flex flex-row flex-wrap items-center gap-3">
        <Button onClick={() => setCreating(true)}>{t('actions.create')}</Button>
        {isAdmin && (
          <Input className="max-w-xs" placeholder={t('ownerFilter')} aria-label={t('ownerFilter')} value={owner} onChange={(e) => setOwner(e.target.value.trim())} />
        )}
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error ?? revoke.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.owner')}</TableHead>
              <TableHead>{t('columns.preset')}</TableHead>
              <TableHead>{t('columns.danger')}</TableHead>
              <TableHead>{t('columns.secrets')}</TableHead>
              <TableHead>{t('columns.runtime')}</TableHead>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead>{t('columns.lastUsed')}</TableHead>
              <TableHead>{t('columns.expires')}</TableHead>
              <TableHead>{t('columns.actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={10} className="text-muted-foreground text-center">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {tokens.map((tok) => (
              <TableRow key={tok.id} data-testid={`token-${tok.id}`}>
                <TableCell className="font-medium">{tok.name}</TableCell>
                <TableCell>{tok.owner}</TableCell>
                <TableCell>{tok.preset}</TableCell>
                <TableCell className="flex flex-wrap gap-1">
                  {tok.danger.map((d) => (
                    <Badge key={d} variant="outline">
                      {t(`dangers.${d}` as 'dangers.master', { defaultValue: d })}
                    </Badge>
                  ))}
                </TableCell>
                <TableCell>{tok.scopes.includes('secrets') ? t('yes') : t('no')}</TableCell>
                <TableCell>{tok.runtime}</TableCell>
                <TableCell>{t(`states.${tok.state}` as 'states.active', { defaultValue: tok.state })}</TableCell>
                <TableCell>{time(tok.last_used_at) || t('never')}</TableCell>
                <TableCell>{time(tok.expires_at) || t('noExpiry')}</TableCell>
                <TableCell className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={tok.state === 'revoked'} onClick={() => setEditing(tok)}>
                    {t('actions.update')}
                  </Button>
                  <Button size="sm" variant="destructive" disabled={tok.state === 'revoked'} onClick={() => void onRevoke(tok)}>
                    {t('actions.revoke')}
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
      {creating && (
        <TokenForm
          onClose={() => setCreating(false)}
          onCreated={(plain) => {
            setCreating(false)
            setCreated(plain)
            void refresh()
          }}
        />
      )}
      {editing && (
        <TokenForm
          token={editing}
          onClose={() => setEditing(null)}
          onCreated={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      {created && <CreatedToken plain={created} onClose={() => setCreated(null)} />}
    </Card>
  )
}

function initialMode(tok?: Token): { mode: ScopeMode; dangers: string[] } {
  if (!tok) return { mode: 'readonly', dangers: [] }
  if (tok.preset === 'readonly' || tok.preset === 'full') return { mode: tok.preset, dangers: [] }
  return tok.danger.length > 0 ? { mode: 'custom', dangers: tok.danger } : { mode: 'ops', dangers: [] }
}

// scopeFlags 把权限的选择换成 flag：自定义时恰好打开所选的危险类（一个都没选等于 ops），否则按预设。
function scopeFlags(mode: ScopeMode, dangers: string[]): Record<string, FlagValue> {
  if (mode === 'custom') return dangers.length > 0 ? { danger: dangers } : { preset: 'ops' }
  return { preset: mode }
}

// TokenForm 是新建与改令牌的对话框；保存之前当场验证。改的时候只发改了的项（token update 至少要一项）。
function TokenForm({ token, onClose, onCreated }: { token?: Token; onClose: () => void; onCreated: (plain: string) => void }) {
  const { t } = useTranslation('tokens')
  const dialogs = useDialogs()
  const init = initialMode(token)
  const [name, setName] = useState(token?.name ?? '')
  const [mode, setMode] = useState<ScopeMode>(init.mode)
  const [dangers, setDangers] = useState<string[]>(init.dangers)
  const [secrets, setSecrets] = useState(token?.scopes.includes('secrets') ?? false)
  const [expiresIn, setExpiresIn] = useState('')
  const [runtime, setRuntime] = useState('')
  const [nothing, setNothing] = useState(false)
  const save = useMutation({
    mutationFn: ({ flags, verify }: { flags: Record<string, FlagValue>; verify: Verification }) =>
      token ? run('token update', { args: [String(token.id)], flags, verify }) : run<{ token: string }>('token create', { flags, verify }),
    onSuccess: (res) => onCreated(token ? '' : (res as { token: string }).token),
  })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    let flags: Record<string, FlagValue>
    if (token) {
      flags = {}
      if (name !== token.name) flags.name = name
      const changedScope = mode !== init.mode || [...dangers].sort().join() !== [...init.dangers].sort().join()
      if (changedScope) Object.assign(flags, scopeFlags(mode, dangers))
      if (secrets !== token.scopes.includes('secrets')) flags.secrets = secrets
      if (expiresIn.trim()) flags['expires-in'] = expiresIn.trim()
      if (Object.keys(flags).length === 0) {
        setNothing(true)
        return
      }
    } else {
      flags = { name, ...scopeFlags(mode, dangers), secrets: secrets || undefined, 'expires-in': expiresIn.trim() || undefined, runtime: runtime.trim() || undefined }
    }
    setNothing(false)
    const verify = await dialogs.verify()
    if (verify) save.mutate({ flags, verify })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{token ? t('form.updateTitle', { name: token.name }) : t('form.createTitle')}</DialogTitle>
            <DialogDescription />
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="token-name">{t('form.name')}</Label>
            <Input id="token-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>{t('form.scope')}</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as ScopeMode)}>
              <SelectTrigger aria-label={t('form.scope')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['readonly', 'ops', 'full', 'custom'] as const).map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`form.scopes.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode === 'custom' && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                {DANGERS.map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={dangers.includes(d)} onCheckedChange={(v) => setDangers((cur) => (v === true ? [...cur, d] : cur.filter((x) => x !== d)))} />
                    {t(`dangers.${d}`)}
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={secrets} onCheckedChange={(v) => setSecrets(v === true)} />
            {t('form.secrets')}
          </label>
          <div className="grid gap-1.5">
            <Label htmlFor="token-expires">{token ? t('form.expiresInUpdate') : t('form.expiresIn')}</Label>
            <Input id="token-expires" value={expiresIn} onChange={(e) => setExpiresIn(e.target.value)} />
          </div>
          {!token && (
            <div className="grid gap-1.5">
              <Label htmlFor="token-runtime">{t('form.runtime')}</Label>
              <Input id="token-runtime" value={runtime} onChange={(e) => setRuntime(e.target.value)} />
            </div>
          )}
          {nothing && <p className="text-muted-foreground text-sm">{t('form.nothing')}</p>}
          <ErrorNotice error={save.error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" disabled={!name || save.isPending}>
              {t('form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CreatedToken({ plain, onClose }: { plain: string; onClose: () => void }) {
  const { t } = useTranslation('tokens')
  const copy = async () => {
    await navigator.clipboard.writeText(plain)
    toast.success(t('actions.copied', { ns: 'common' }))
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('created.title')}</DialogTitle>
          <DialogDescription>{t('created.warning')}</DialogDescription>
        </DialogHeader>
        <code className="bg-muted rounded p-2 font-mono text-sm break-all" data-testid="token-plain">
          {plain}
        </code>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copy()}>
            {t('actions.copy', { ns: 'common' })}
          </Button>
          <Button onClick={onClose}>{t('created.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Connections() {
  const { t } = useTranslation('tokens')
  const list = useQuery({ queryKey: ['mcp status'], queryFn: () => run<Page<Token>>('mcp status', { limit: 100 }) })
  const items = list.data?.items ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('connections.hint')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('columns.runtime')}</TableHead>
              <TableHead>{t('columns.name')}</TableHead>
              <TableHead>{t('columns.owner')}</TableHead>
              <TableHead>{t('columns.state')}</TableHead>
              <TableHead>{t('columns.lastUsed')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {t('connections.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((tok) => (
              <TableRow key={tok.id}>
                <TableCell className="font-medium">{tok.runtime}</TableCell>
                <TableCell>{tok.name}</TableCell>
                <TableCell>{tok.owner}</TableCell>
                <TableCell>{t(`states.${tok.state}` as 'states.active', { defaultValue: tok.state })}</TableCell>
                <TableCell>{time(tok.last_used_at) || t('never')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function McpHelp() {
  const { t } = useTranslation('tokens')
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('mcp.title')}</CardTitle>
        <CardDescription>{t('mcp.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        <p>{t('mcp.sameHost')}</p>
        <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-xs">{t('mcp.sameHostCommand')}</pre>
        <p>{t('mcp.otherHost')}</p>
        <pre className="bg-muted overflow-x-auto rounded p-2 font-mono text-xs">{t('mcp.otherHostCommand')}</pre>
      </CardContent>
    </Card>
  )
}
