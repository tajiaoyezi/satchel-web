import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run } from '@/api/client'
import type { Page } from '@/api/types'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WideDialog } from '@/components/WideDialog'
import { formatTime } from '@/lib/format'

import { NewRuleDialog, short, useSavePreset, type RuleDraft } from './-routing'
import { Field, JsonField, LocalError, useProxyRefresh } from './-shared'

// 代理页的「预设」（web-console「代理页」，m2-20 design 第 5 到 7 条）：内置预设、已保存的预设、保存与删除。
// 第一次打开这一页时才请求；预设不是配置对象，保存与删除不走预演。

interface BuiltinPreset {
  key: string
  name: string
  description: string
  match: unknown
  default_outbound_tag: string
  rule_sets?: { tag: string }[] | null
}

interface SavedPreset {
  id: number
  username: string
  name: string
  rule: unknown
  updated_at: string
}

export function PresetsTab({ server, enabled }: { server: ServerSummary | null; enabled: boolean }) {
  const refresh = useProxyRefresh()
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  return (
    <div className="grid gap-4">
      <Builtin enabled={enabled} onUse={setDraft} />
      <Saved enabled={enabled} onUse={setDraft} />
      {draft && <NewRuleDialog initialServer={server?.id ?? null} draft={draft} onClose={() => setDraft(null)} onApplied={refresh} />}
    </div>
  )
}

function Builtin({ enabled, onUse }: { enabled: boolean; onUse: (d: RuleDraft) => void }) {
  const { t } = useTranslation('proxy')
  const list = useQuery({
    queryKey: ['routing preset builtin'],
    queryFn: () => run<{ items: BuiltinPreset[]; total: number }>('routing preset builtin'),
    enabled,
    staleTime: Infinity,
  })
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('presets.builtinTitle')}</CardTitle>
        <CardDescription>{t('presets.builtinDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('presets.name')}</TableHead>
              <TableHead>{t('presets.ruleDescription')}</TableHead>
              <TableHead>{t('cols.match')}</TableHead>
              <TableHead>{t('presets.defaultOutbound')}</TableHead>
              <TableHead>{t('presets.ruleSets')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list.data?.items ?? []).map((p) => (
              <TableRow key={p.key} data-testid={`builtin-${p.key}`}>
                <TableCell>
                  <div>{p.name}</div>
                  <div className="text-muted-foreground font-mono text-xs">{p.key}</div>
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal">{p.description}</TableCell>
                <TableCell className="max-w-80 font-mono text-xs break-all whitespace-normal">{short(p.match)}</TableCell>
                <TableCell className="font-mono">{p.default_outbound_tag}</TableCell>
                <TableCell className="font-mono text-xs whitespace-normal">{(p.rule_sets ?? []).map((r) => r.tag).join(', ') || t('none')}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => onUse({ preset: p.name, match: p.match, outboundTag: p.default_outbound_tag })}>
                    {t('presets.use')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function Saved({ enabled, onUse }: { enabled: boolean; onUse: (d: RuleDraft) => void }) {
  const { t } = useTranslation('proxy')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const list = useInfiniteQuery({
    queryKey: ['routing preset list'],
    queryFn: ({ pageParam }) => run<Page<SavedPreset>>('routing preset list', { limit: 50, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  })
  const del = useMutation({
    mutationFn: (id: number) => run('routing preset delete', { args: [String(id)], confirm: String(id) }),
    onSuccess: () => {
      toast.success(t('presets.deleted'))
      return queryClient.invalidateQueries({ queryKey: ['routing preset list'] })
    },
  })
  // 删除是危险类「删除」：先弹危险确认，确认值是预设编号（design 第 7 条）
  const onDelete = async (p: SavedPreset) => {
    const ok = await dialogs.confirm({ title: t('presets.deleteTitle', { name: p.name, id: p.id }), description: t('presets.deleteDescription'), value: String(p.id), destructive: true })
    if (ok) del.mutate(p.id)
  }
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardTitle>{t('presets.savedTitle')}</CardTitle>
        <div className="flex flex-wrap items-end gap-2">
          <CardDescription>{t('presets.savedDescription')}</CardDescription>
          <Button className="ml-auto" onClick={() => setSaving(true)}>
            {t('presets.save')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error ?? del.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cols.id')}</TableHead>
              <TableHead>{t('presets.name')}</TableHead>
              <TableHead>{t('presets.owner')}</TableHead>
              <TableHead>{t('cols.match')}</TableHead>
              <TableHead>{t('presets.updatedAt')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground text-center">
                  {t('presets.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((p) => (
              <TableRow key={p.id} data-testid={`preset-row-${p.id}`}>
                <TableCell className="font-mono">{p.id}</TableCell>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.username}</TableCell>
                <TableCell className="max-w-80 font-mono text-xs break-all whitespace-normal">{short(p.rule)}</TableCell>
                <TableCell>{formatTime(p.updated_at)}</TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => onUse({ preset: p.name, match: p.rule })}>
                    {t('presets.use')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => void onDelete(p)}>
                    {t('presets.delete')}
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
      {saving && <SavePresetDialog onClose={() => setSaving(false)} />}
    </Card>
  )
}

function SavePresetDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('proxy')
  const [name, setName] = useState('')
  const [rule, setRule] = useState('')
  const { submit, localError, save } = useSavePreset(onClose)
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit(name, rule)
  }
  return (
    <WideDialog title={t('presets.save')} onClose={onClose}>
      <form className="grid gap-3" onSubmit={onSubmit}>
        <Field id="preset-name" label={t('presets.name')}>
          <Input id="preset-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <JsonField id="preset-rule" label={t('fields.match')} value={rule} onChange={setRule} />
        <LocalError message={localError} />
        <ErrorNotice error={save.error} />
        <div>
          <Button type="submit" disabled={!name.trim() || save.isPending}>
            {t('presets.saveSubmit')}
          </Button>
        </div>
      </form>
    </WideDialog>
  )
}
