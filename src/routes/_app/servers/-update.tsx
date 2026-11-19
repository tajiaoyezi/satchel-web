import { useTranslation } from 'react-i18next'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

// 节点 satchel-agent 升级的共用部分：详情页的维护页与列表页的批量升级都用（m2-10 design 第 3、4 条）。

// UpdateCheckItem 是 server update check 一台服务器的结果；不带名字时主控回 UpdateCheckList。
export interface UpdateCheckItem {
  server: string
  channel: string
  current_version: string
  latest_version: string
  has_update: boolean
  in_docker: boolean
  reachable: boolean
  compatible: boolean
  can_apply: boolean
  reason?: string
}

export interface UpdateCheckList {
  channel: string
  latest_version: string
  items: UpdateCheckItem[]
  total: number
}

// UpdateTargetResult 是一台服务器升级的结局：单台升级 done 时的 output，批量升级 output 与失败 state 里 results 的每一项。
export interface UpdateTargetResult {
  server: string
  from_version?: string
  to_version?: string
  status: string // done | failed | skipped | aborted
  disk_state?: string // old | old_after_swap | new_unconfirmed
  retryable?: boolean
  reason?: string
}

export const CHANNELS = ['stable', 'prerelease'] as const
export type Channel = (typeof CHANNELS)[number]

export function ChannelSelect({ id, value, onChange }: { id: string; value: Channel; onChange: (v: Channel) => void }) {
  const { t } = useTranslation('servers')
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Channel)}>
      <SelectTrigger id={id} aria-label={t('update.channel')} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CHANNELS.map((ch) => (
          <SelectItem key={ch} value={ch}>
            {t(`update.channels.${ch}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// UpdateFailure 把单台升级失败时主控给的 disk_state 与 retryable 写成人能看懂的话。
export function UpdateFailure({ state }: { state: Record<string, unknown> }) {
  const { t } = useTranslation('servers')
  const disk = typeof state.disk_state === 'string' ? state.disk_state : ''
  if (!disk) return null
  return (
    <div className="grid gap-1 text-sm" data-testid="update-failure">
      <p>{t(`update.disk.${disk}` as 'update.disk.old', { defaultValue: disk })}</p>
      <p>{state.retryable === true ? t('update.retryable') : t('update.notRetryable')}</p>
    </div>
  )
}

// UpdateResults 逐台列出批量升级的结局：成功、失败或中止，失败与中止写原因，失败写磁盘状态。
export function UpdateResults({ results }: { results: UpdateTargetResult[] }) {
  const { t } = useTranslation('servers')
  return (
    <Table data-testid="update-results">
      <TableHeader>
        <TableRow>
          <TableHead>{t('batch.server')}</TableHead>
          <TableHead>{t('batch.result')}</TableHead>
          <TableHead>{t('batch.version')}</TableHead>
          <TableHead>{t('batch.reason')}</TableHead>
          <TableHead>{t('batch.disk')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {results.map((r) => (
          <TableRow key={r.server} data-testid={`update-result-${r.server}`}>
            <TableCell className="font-mono">{r.server}</TableCell>
            <TableCell>{t(`batch.statuses.${r.status}` as 'batch.statuses.done', { defaultValue: r.status })}</TableCell>
            <TableCell className="font-mono whitespace-nowrap">{t('batch.fromTo', { from: r.from_version || '-', to: r.to_version || '-' })}</TableCell>
            <TableCell>{r.reason ?? ''}</TableCell>
            <TableCell>{r.disk_state ? t(`batch.diskShort.${r.disk_state}` as 'batch.diskShort.old', { defaultValue: r.disk_state }) : ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
