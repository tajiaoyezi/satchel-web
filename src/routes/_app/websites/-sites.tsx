import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run, type FlagValue } from '@/api/client'
import type { Page } from '@/api/types'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { WideDialog } from '@/components/WideDialog'

import { PlanReview, type PlanView } from '../-plan'
import { Field, LocalError, MaskedValue, ServerPicker, useObjectOp, useServers } from '../proxy/-shared'
import { Fields } from '../servers/-shared'

// 网站页的「站点」（web-console「网站页」，m2-22 design 第 2、3、8 条）：列表、详情与编辑、向导、删除与恢复。
// 域名与目标合不合法都由主控判定，网页只去掉两头空格。

interface WebsiteSpec {
  server_id: number
  domain: string
  type: string
  target: string
  certificate_id: number | null
  use_443: boolean
}

interface WebsiteView {
  metadata: { id: number; resourceVersion: number; deletedAt?: string | null }
  spec: WebsiteSpec
  status: { scanned: unknown; managed: boolean; conf_path: string }
  server_name?: string
}

interface TemplateInfo {
  id: string
  type: string
  display_name: string
  description: string
  target_format: string
  example_target: string
}

interface BuildView {
  server: string
  same_host_as_master: boolean
  requires_human?: boolean
  conf_path: string
  preview_conf: string
  html_path?: string
  plan_op: unknown
}

const TYPES = ['static', 'proxy', 'decoy'] as const
const ALL = 'all'

export const templatesQuery = {
  queryKey: ['website templates'],
  queryFn: () => run<{ templates: TemplateInfo[] | null; rules: string[] | null }>('website templates'),
  staleTime: Infinity,
}

// useWebsiteRefresh：网站的计划提交、扫描之后，让站点列表与详情重新读取（design 第 8 条）。
export function useWebsiteRefresh() {
  const queryClient = useQueryClient()
  return () => void Promise.all(['website list', 'website get'].map((k) => queryClient.invalidateQueries({ queryKey: [k] })))
}

export function SitesTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('websites')
  const refresh = useWebsiteRefresh()
  const op = useObjectOp(refresh)
  const [type, setType] = useState('')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [viewing, setViewing] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const name = server?.name ?? ''
  const list = useInfiniteQuery({
    queryKey: ['website list', name, type, includeDeleted],
    queryFn: ({ pageParam }) =>
      run<Page<WebsiteView>>('website list', {
        flags: { 'server-name': name || undefined, type: type || undefined, 'include-deleted': includeDeleted || undefined },
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('sites.description')}</CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={type || ALL} onValueChange={(v) => setType(v === ALL ? '' : v)}>
            <SelectTrigger aria-label={t('typeFilter')} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('types.all')}</SelectItem>
              {TYPES.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`types.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={includeDeleted} onCheckedChange={setIncludeDeleted} aria-label={t('includeDeleted')} />
            {t('includeDeleted')}
          </label>
          <div className="ml-auto">
            <Button onClick={() => setCreating(true)}>{t('sites.create')}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={list.error} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('cols.id')}</TableHead>
              <TableHead>{t('cols.server')}</TableHead>
              <TableHead>{t('cols.domain')}</TableHead>
              <TableHead>{t('cols.type')}</TableHead>
              <TableHead>{t('cols.target')}</TableHead>
              <TableHead>{t('cols.use443')}</TableHead>
              <TableHead>{t('cols.managed')}</TableHead>
              <TableHead>{t('cols.confPath')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && list.isSuccess && (
              <TableRow>
                <TableCell colSpan={9} className="text-muted-foreground text-center">
                  {t('sites.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((w) => {
              const deleted = !!w.metadata.deletedAt
              const target = { kind: 'Website' as const, id: w.metadata.id, resourceVersion: w.metadata.resourceVersion, label: w.spec.domain }
              return (
                <TableRow key={w.metadata.id} data-testid={`website-row-${w.metadata.id}`}>
                  <TableCell className="font-mono">{w.metadata.id}</TableCell>
                  <TableCell>{w.server_name ?? w.spec.server_id}</TableCell>
                  <TableCell className="font-mono">{w.spec.domain}</TableCell>
                  <TableCell>{t(`types.${w.spec.type}` as 'types.static', { defaultValue: w.spec.type })}</TableCell>
                  <TableCell className="max-w-60 font-mono text-xs break-all whitespace-normal">{w.spec.target || t('none')}</TableCell>
                  <TableCell>{w.spec.use_443 ? t('yes') : t('no')}</TableCell>
                  <TableCell>{deleted ? <Badge variant="destructive">{t('deleted')}</Badge> : <Badge variant={w.status.managed ? 'default' : 'outline'}>{w.status.managed ? t('yes') : t('no')}</Badge>}</TableCell>
                  <TableCell className="max-w-60 font-mono text-xs break-all whitespace-normal">{w.status.conf_path || t('none')}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {deleted ? (
                      <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'restore' })}>
                        {t('op.restore', { ns: 'proxy' })}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setViewing(w.metadata.id)}>
                          {t('view')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => op.start({ ...target, op: 'delete' })}>
                          {t('op.delete', { ns: 'proxy' })}
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('loadMore')}
          </Button>
        )}
      </CardContent>
      {viewing !== null && <WebsiteDialog id={viewing} onClose={() => setViewing(null)} onApplied={refresh} />}
      {creating && <WebsiteWizard initialServer={server?.id ?? null} onClose={() => setCreating(false)} onApplied={refresh} />}
      {op.dialog}
    </Card>
  )
}

function TypeSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const { t } = useTranslation('websites')
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={t('cols.type')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {TYPES.map((k) => (
          <SelectItem key={k} value={k}>
            {t(`types.${k}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function WebsiteDialog({ id, onClose, onApplied }: { id: number; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('websites')
  const site = useQuery({ queryKey: ['website get', id], queryFn: () => run<WebsiteView>('website get', { args: [String(id)] }) })
  // 计划放在表单外面：提交会抬高版本、表单按新版本重新挂载，预演与提交的结果仍然留着
  const [plan, setPlan] = useState<PlanView | null>(null)
  const d = site.data
  return (
    <WideDialog title={t('sites.detailTitle', { id })} onClose={onClose}>
      <ErrorNotice error={site.error} />
      {d && (
        <div className="grid gap-4" data-testid="website-detail">
          <Fields
            rows={[
              [t('cols.server'), d.server_name ?? d.spec.server_id],
              [t('cols.managed'), d.status.managed ? t('yes') : t('no')],
              [t('cols.confPath'), d.status.conf_path || t('none')],
              [t('sites.certificate'), d.spec.certificate_id ?? t('none')],
              [t('sites.scanned'), <MaskedValue v={d.status.scanned} />],
            ]}
          />
          <WebsiteForm key={d.metadata.resourceVersion} site={d} onPlanned={setPlan} />
        </div>
      )}
      {plan && <PlanReview key={plan.plan_id} plan={plan} onApplied={onApplied} />}
    </WideDialog>
  )
}

// WebsiteForm 编辑一个站点（design 第 2 条）：服务器不能改；只发改过的字段，没有改动时提示、不发请求。
function WebsiteForm({ site, onPlanned }: { site: WebsiteView; onPlanned: (p: PlanView) => void }) {
  const { t } = useTranslation('websites')
  const s = site.spec
  const [domain, setDomain] = useState(s.domain)
  const [type, setType] = useState(s.type)
  const [target, setTarget] = useState(s.target)
  const [use443, setUse443] = useState(s.use_443)
  const [localError, setLocalError] = useState('')
  const preview = useMutation({ mutationFn: (op: object) => run<PlanView>('plan', { flags: { spec: JSON.stringify(op) } }), onSuccess: onPlanned })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const changed: Record<string, unknown> = {}
    if (domain.trim() !== s.domain) changed.domain = domain.trim()
    if (type !== s.type) changed.type = type
    if (target.trim() !== s.target) changed.target = target.trim()
    if (use443 !== s.use_443) changed.use_443 = use443
    if (Object.keys(changed).length === 0) return setLocalError(t('sites.noChange'))
    setLocalError('')
    preview.mutate({ op: 'update', kind: 'Website', id: site.metadata.id, resourceVersion: site.metadata.resourceVersion, spec: changed })
  }
  return (
    <form className="grid gap-3 rounded-md border p-3" onSubmit={submit}>
      <p className="text-sm font-medium">{t('sites.editTitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="site-domain" label={t('cols.domain')}>
          <Input id="site-domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <Field id="site-type" label={t('cols.type')}>
          <TypeSelect id="site-type" value={type} onChange={setType} />
        </Field>
      </div>
      <Field id="site-target" label={t('cols.target')} hint={t(`targetHint.${type}` as 'targetHint.static', { defaultValue: '' })}>
        <Input id="site-target" value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={use443} onCheckedChange={setUse443} aria-label={t('wizard.use443')} />
        {t('wizard.use443')}
      </label>
      <LocalError message={localError} />
      <ErrorNotice error={preview.error} />
      <div>
        <Button type="submit" disabled={preview.isPending}>
          {t('preview')}
        </Button>
      </div>
    </form>
  )
}

interface WizardValues {
  serverId: number | null
  domain: string
  type: string
  target: string
  wssPath: string
  use443: boolean
}

// WebsiteWizard（design 第 3 条）：website build 生成预览配置与 plan_op，再拿 plan_op 预演。改了参数就丢掉预演结果，
// 旧的生成结果不能再预演；提交之后锁住，免得改参数时把提交结果一起清掉。下拉框（Radix Select）不看外层 fieldset 的
// disabled，所以另外传 disabled。
function WebsiteWizard({ initialServer, onClose, onApplied }: { initialServer: number | null; onClose: () => void; onApplied: () => void }) {
  const { t } = useTranslation('websites')
  const servers = useServers()
  const [v, setV] = useState<WizardValues>({ serverId: initialServer, domain: '', type: 'static', target: '', wssPath: '', use443: false })
  const [builtFor, setBuiltFor] = useState('')
  const [applied, setApplied] = useState(false)
  const params = JSON.stringify(v)
  const templates = useQuery({ ...templatesQuery, enabled: v.type === 'decoy' })
  const build = useMutation({ mutationFn: (flags: Record<string, FlagValue>) => run<BuildView>('website build', { flags }) })
  const preview = useMutation({ mutationFn: (op: unknown) => run<PlanView>('plan', { flags: { spec: JSON.stringify(op) } }) })
  const name = servers.find((s) => s.id === v.serverId)?.name ?? ''
  const set = (patch: Partial<WizardValues>) => {
    setV((prev) => ({ ...prev, ...patch }))
    preview.reset()
  }
  const generate = (e: FormEvent) => {
    e.preventDefault()
    const flags: Record<string, FlagValue> = { 'server-name': name, domain: v.domain.trim(), type: v.type }
    if (v.target.trim()) flags.target = v.target.trim()
    if (v.type === 'proxy' && v.wssPath.trim()) flags['wss-path'] = v.wssPath.trim()
    if (v.use443) flags['use-443'] = true
    setBuiltFor(params)
    preview.reset()
    build.mutate(flags)
  }
  const b = build.data
  const stale = !!b && builtFor !== params
  const decoys = (templates.data?.templates ?? []).filter((x) => x.type === 'decoy')
  return (
    <WideDialog title={t('wizard.title')} description={t('wizard.description')} onClose={onClose}>
      <form className="grid gap-3" onSubmit={generate}>
        <fieldset className="grid gap-3" disabled={applied}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="wiz-site-server" label={t('server.label')}>
              <ServerPicker id="wiz-site-server" label={t('server.label')} value={v.serverId} onChange={(id) => set({ serverId: id })} disabled={applied} />
            </Field>
            <Field id="wiz-site-domain" label={t('cols.domain')}>
              <Input id="wiz-site-domain" value={v.domain} onChange={(e) => set({ domain: e.target.value })} />
            </Field>
            <Field id="wiz-site-type" label={t('cols.type')}>
              <TypeSelect id="wiz-site-type" value={v.type} onChange={(type) => set({ type })} disabled={applied} />
            </Field>
            <Field id="wiz-site-target" label={t('cols.target')} hint={t(`targetHint.${v.type}` as 'targetHint.static')}>
              <Input id="wiz-site-target" value={v.target} onChange={(e) => set({ target: e.target.value })} />
            </Field>
            {v.type === 'proxy' && (
              <Field id="wiz-site-wss" label={t('wizard.wssPath')} hint={t('wizard.wssPathHint')}>
                <Input id="wiz-site-wss" value={v.wssPath} onChange={(e) => set({ wssPath: e.target.value })} />
              </Field>
            )}
          </div>
          {v.type === 'decoy' && decoys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('wizard.templates')}</span>
              {decoys.map((x) => (
                <Button key={x.id} type="button" size="sm" variant="outline" onClick={() => set({ target: x.target_format })}>
                  {x.display_name}
                </Button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={v.use443} onCheckedChange={(on) => set({ use443: on })} aria-label={t('wizard.use443')} />
            {t('wizard.use443')}
          </label>
        </fieldset>
        <ErrorNotice error={build.error} />
        {applied ? (
          <p className="text-muted-foreground text-sm" data-testid="website-wizard-locked">
            {t('wizard.locked')}
          </p>
        ) : (
          <div>
            <Button type="submit" disabled={name === '' || v.domain.trim() === '' || build.isPending}>
              {t('wizard.generate')}
            </Button>
          </div>
        )}
      </form>
      {b && (
        <div className="grid gap-3" data-testid="website-build">
          <Fields rows={[[t('wizard.confPath'), <span className="font-mono text-xs break-all">{b.conf_path}</span>], ...(b.html_path ? [[t('wizard.htmlPath'), <span className="font-mono text-xs break-all">{b.html_path}</span>] as [string, ReactNode]] : [])]} />
          {b.same_host_as_master && (
            <Alert>
              <AlertDescription>{t('wizard.sameHost')}</AlertDescription>
            </Alert>
          )}
          {b.requires_human && (
            <Alert>
              <AlertDescription>{t('wizard.requiresHuman')}</AlertDescription>
            </Alert>
          )}
          <p className="text-sm font-medium">{t('wizard.previewConf')}</p>
          <pre className="bg-muted max-h-96 overflow-auto rounded p-2 font-mono text-xs" data-testid="website-preview">
            {b.preview_conf}
          </pre>
          {stale && <LocalError message={t('wizard.stale')} />}
          {!applied && (
            <div>
              <Button disabled={stale || preview.isPending} onClick={() => preview.mutate(b.plan_op)}>
                {t('preview')}
              </Button>
            </div>
          )}
          <ErrorNotice error={preview.error} />
        </div>
      )}
      {preview.data && (
        <PlanReview
          key={preview.data.plan_id}
          plan={preview.data}
          onApplied={() => {
            setApplied(true)
            onApplied()
          }}
        />
      )}
    </WideDialog>
  )
}
