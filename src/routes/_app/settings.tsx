import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ApiError, run, upload } from '@/api/client'
import { settingsShowQuery } from '@/api/queries'
import type { Page, SettingsObject } from '@/api/types'
import { updateBoot } from '@/boot'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Turnstile } from '@/components/Turnstile'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { IMPLEMENTED, THEMES } from '@/theme/themes'

export const Route = createFileRoute('/_app/settings')({ component: SettingsPage })

interface Snapshot {
  id: number
  object_version: number
  created_at: string
  source: string
  content_hash: string
}

interface TurnstileResult {
  success: boolean
  error_codes: string[]
  hostname: string
}

const BRANDING = [
  ['branding_site_title', 'branding.siteTitle'],
  ['branding_brand_title', 'branding.brandTitle'],
  ['branding_logo_url', 'branding.logoUrl'],
  ['login_wallpaper', 'branding.loginWallpaper'],
] as const
// IMAGE_FIELDS 旁边有「上传」：图片交给 settings image upload，地址填回输入框（master-settings「上传图片」）。
const IMAGE_FIELDS = new Set<string>(['branding_logo_url', 'login_wallpaper'])
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/x-icon'
const MASTER_URL = ['master_url', 'subscription_url'] as const
const GATE_SWITCHES = ['master_local_only', 'silent_mode', 'probe_disguise_block_login', 'brute_force_enabled', 'skip_local_ip'] as const
const GATE_NUMBERS = [
  'silent_mode_timeout',
  'login_rate_max_attempts',
  'login_rate_window_minutes',
  'login_rate_lock_minutes',
  'brute_force_max_failures',
  'brute_force_window_minutes',
  'brute_force_block_minutes',
] as const
const GATE_TEXTS = ['turnstile_site_key', 'turnstile_secret_key', 'trusted_proxies'] as const

type Values = Record<string, unknown>

// MASKED 是打码字段的占位：主控收到它表示这个字段保持不变。
const MASKED = '***'

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v))
const camel = (field: string) => field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

// 系统设置页（web-console「系统设置页」）：只对管理员可用；打开时 settings show，每次写都带读到的 resourceVersion。
function SettingsPage() {
  const { t } = useTranslation('settings')
  return (
    <AdminPage title={t('title')}>
      <SettingsBody />
    </AdminPage>
  )
}

function SettingsBody() {
  const { t } = useTranslation('settings')
  const show = useQuery(settingsShowQuery)
  if (show.error) return <ErrorNotice error={show.error} />
  if (!show.data) return <p className="text-muted-foreground">{t('loading', { ns: 'common' })}</p>
  const values: Values = { ...show.data.spec, ...show.data.status }
  // 每个分区的表单按自己那几个字段的值重置：重新读取后值变了的分区换成新值，别的分区里没保存的输入留着。
  const keyOf = (fields: readonly string[]) => JSON.stringify(fields.map((f) => values[f]))
  return (
    <>
      <p className="text-muted-foreground text-sm">{t('version', { version: show.data.metadata.resourceVersion })}</p>
      <BrandingCard key={keyOf([...BRANDING.map(([f]) => f), 'default_theme'])} values={values} />
      <MasterUrlCard key={keyOf(MASTER_URL)} values={values} />
      <GatesCard key={keyOf([...GATE_SWITCHES, ...GATE_NUMBERS, ...GATE_TEXTS])} values={values} />
      <UpdateCdnCard enabled={values.update_cdn_enabled === true} />
      <SnapshotsCard />
    </>
  )
}

type Write = (resourceVersion: number) => Promise<SettingsObject>

// useSettingsWrite 是各分区共用的写：发请求时取当前读到的 resourceVersion；成功后用主控回的对象换掉读到的设置，
// 并把品牌字段换进页面的启动配置（回滚也可能改品牌）。
function useSettingsWrite() {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  return useMutation<SettingsObject, Error, Write>({
    mutationFn: (write) => write(queryClient.getQueryData(settingsShowQuery.queryKey)?.metadata.resourceVersion ?? 0),
    onSuccess: (obj) => {
      queryClient.setQueryData(settingsShowQuery.queryKey, obj)
      void queryClient.invalidateQueries({ queryKey: ['settings snapshots list'] })
      updateBoot({
        site_title: str(obj.spec.branding_site_title),
        brand_title: str(obj.spec.branding_brand_title),
        logo_url: str(obj.spec.branding_logo_url),
        login_wallpaper: str(obj.spec.login_wallpaper),
        default_theme: str(obj.spec.default_theme),
      })
      toast.success(t('saved'))
    },
  })
}

// WriteError 显示一次写的失败：主控的 reason 原样；version_conflict 时另外提示别人刚改过，重新读取后再改，不自动覆盖。
function WriteError({ write }: { write: ReturnType<typeof useSettingsWrite> }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()
  if (!write.error) return null
  const reload = async () => {
    await queryClient.refetchQueries({ queryKey: settingsShowQuery.queryKey })
    write.reset()
  }
  return (
    <div className="grid gap-2">
      <ErrorNotice error={write.error} />
      {write.error instanceof ApiError && write.error.code === 'version_conflict' && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('conflict')}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void reload()}>
              {t('actions.refresh', { ns: 'common' })}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  )
}

function BrandingCard({ values }: { values: Values }) {
  const { t } = useTranslation('settings')
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries([...BRANDING.map(([f]) => [f, str(values[f])]), ['default_theme', str(values.default_theme)]]))
  const write = useSettingsWrite()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    write.mutate((rv) => run<SettingsObject>('settings set', { flags: { set: form, 'resource-version': rv } }))
  }
  return (
    <Section title={t('branding.title')} description={t('branding.description')}>
      <form className="grid gap-4" onSubmit={submit}>
        {BRANDING.map(([f, label]) => (
          <Field key={f} id={f} label={t(label)}>
            {IMAGE_FIELDS.has(f) ? (
              <ImageInput id={f} value={form[f]} onChange={(v) => setForm((cur) => ({ ...cur, [f]: v }))} />
            ) : (
              <Input id={f} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
            )}
          </Field>
        ))}
        <p className="text-muted-foreground text-xs">{t('branding.uploadHint')}</p>
        <div className="grid gap-1.5">
          <Label>{t('branding.defaultTheme')}</Label>
          <Select value={form.default_theme} onValueChange={(v) => setForm({ ...form, default_theme: v })}>
            <SelectTrigger aria-label={t('branding.defaultTheme')} className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {IMPLEMENTED[name] ? t(`themes.${name}`, { ns: 'common' }) : t('branding.notYet', { name: t(`themes.${name}`, { ns: 'common' }) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <WriteError write={write} />
        <Button type="submit" className="justify-self-start" disabled={write.isPending}>
          {t('actions.saveBranding')}
        </Button>
      </form>
    </Section>
  )
}

// previewable 是能当图片预览的地址：与主控对这两个字段的规则一样，以 /、http://、https:// 或 data:image/ 开头。
const previewable = (v: string) => /^(\/|https?:\/\/|data:image\/)/.test(v)

// ImageInput 是图片地址的输入框加「上传」：以文件本身作请求体提交 settings image upload，成功后把返回的地址填进来（照常保存才生效）；
// 主控拒绝时显示它的 reason，输入框不变。accept 只是方便挑文件，类型由主控按内容判定。
function ImageInput({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation('settings')
  const file = useRef<HTMLInputElement>(null)
  const send = useMutation({
    mutationFn: (f: File) => upload<{ url: string }>('settings image upload', f, { contentType: 'application/octet-stream' }),
    onSuccess: (img) => onChange(img.url),
    onSettled: () => {
      if (file.current) file.current.value = ''
    },
  })
  return (
    <div className="grid gap-2">
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <Button type="button" variant="outline" disabled={send.isPending} onClick={() => file.current?.click()}>
          {t('branding.upload')}
        </Button>
        <input
          ref={file}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          data-testid={`${id}-file`}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) send.mutate(f)
          }}
        />
      </div>
      <ErrorNotice error={send.error} />
      {previewable(value) && <img src={value} alt={t('branding.preview')} className="h-12 max-w-48 justify-self-start rounded border object-contain" />}
    </div>
  )
}

function MasterUrlCard({ values }: { values: Values }) {
  const { t } = useTranslation('settings')
  const dialogs = useDialogs()
  const [url, setUrl] = useState(str(values.master_url))
  const [sub, setSub] = useState(str(values.subscription_url))
  const write = useSettingsWrite()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const verify = await dialogs.verify()
    if (!verify) return
    write.mutate((rv) => run<SettingsObject>('settings master-url set', { flags: { url, 'subscription-url': sub, 'resource-version': rv }, verify }))
  }
  return (
    <Section title={t('masterUrl.title')} description={t('masterUrl.description')}>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <Field id="master-url" label={t('masterUrl.url')}>
          <Input id="master-url" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field id="subscription-url" label={t('masterUrl.subscriptionUrl')}>
          <Input id="subscription-url" value={sub} onChange={(e) => setSub(e.target.value)} />
        </Field>
        <WriteError write={write} />
        <Button type="submit" className="justify-self-start" disabled={write.isPending}>
          {t('actions.saveMasterUrl')}
        </Button>
      </form>
    </Section>
  )
}

// GatesCard 是门与登录防护，连同 Turnstile 的两个 key 一起保存。管理员会话带 secrets scope，settings show 给的是
// secret key 的原文；页面只显示 ***（已保存）或空，没改时原样交回 ***，主控当成保持不变。
function GatesCard({ values }: { values: Values }) {
  const { t } = useTranslation('settings')
  const dialogs = useDialogs()
  const [switches, setSwitches] = useState<Record<string, boolean>>(() => Object.fromEntries(GATE_SWITCHES.map((f) => [f, values[f] === true])))
  const [texts, setTexts] = useState<Record<string, string>>(() => ({
    ...Object.fromEntries([...GATE_NUMBERS, 'turnstile_site_key'].map((f) => [f, str(values[f])])),
    turnstile_secret_key: str(values.turnstile_secret_key) === '' ? '' : MASKED,
    trusted_proxies: JSON.stringify(values.trusted_proxies ?? [], null, 2),
  }))
  const write = useSettingsWrite()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const opening = (switches.master_local_only && values.master_local_only !== true) || (switches.silent_mode && values.silent_mode !== true)
    if (opening && !(await dialogs.confirm({ title: t('gates.riskTitle'), description: t('gates.riskDescription'), confirmLabel: t('gates.riskConfirm'), destructive: true }))) return
    const verify = await dialogs.verify()
    if (!verify) return
    write.mutate((rv) => run<SettingsObject>('settings gates set', { flags: { set: { ...switches, ...texts }, 'resource-version': rv }, verify }))
  }
  const label = (f: string) => t(`gates.${camel(f)}` as 'gates.silentMode')
  return (
    <Section title={t('gates.title')} description={t('gates.description')}>
      <form className="grid gap-4" onSubmit={(e) => void submit(e)}>
        <div className="grid gap-3 sm:grid-cols-2">
          {GATE_SWITCHES.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <Switch checked={switches[f]} onCheckedChange={(v) => setSwitches({ ...switches, [f]: v })} aria-label={label(f)} />
              {label(f)}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {GATE_NUMBERS.map((f) => (
            <Field key={f} id={f} label={label(f)}>
              <Input id={f} inputMode="numeric" value={texts[f]} onChange={(e) => setTexts({ ...texts, [f]: e.target.value })} />
            </Field>
          ))}
        </div>
        <Field id="trusted_proxies" label={label('trusted_proxies')}>
          <Textarea id="trusted_proxies" className="font-mono text-xs" rows={4} value={texts.trusted_proxies} onChange={(e) => setTexts({ ...texts, trusted_proxies: e.target.value })} />
        </Field>
        <Separator />
        <div className="grid gap-1">
          <h3 className="font-medium">{t('turnstile.title')}</h3>
          <p className="text-muted-foreground text-sm">{t('turnstile.description')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="turnstile_site_key" label={t('turnstile.siteKey')}>
            <Input id="turnstile_site_key" value={texts.turnstile_site_key} onChange={(e) => setTexts({ ...texts, turnstile_site_key: e.target.value })} />
          </Field>
          <Field id="turnstile_secret_key" label={t('turnstile.secretKey')}>
            <Input id="turnstile_secret_key" value={texts.turnstile_secret_key} onChange={(e) => setTexts({ ...texts, turnstile_secret_key: e.target.value })} />
          </Field>
        </div>
        <TurnstileTest siteKey={str(values.turnstile_site_key)} ready={str(values.turnstile_site_key) !== '' && str(values.turnstile_secret_key) !== ''} />
        <WriteError write={write} />
        <Button type="submit" className="justify-self-start" disabled={write.isPending}>
          {t('actions.saveGates')}
        </Button>
      </form>
    </Section>
  )
}

// TurnstileTest 用已保存的 site key 显示组件，拿到 token 交给 settings turnstile test（master-login-protection）。
function TurnstileTest({ siteKey, ready }: { siteKey: string; ready: boolean }) {
  const { t } = useTranslation('settings')
  const [round, setRound] = useState(0)
  const test = useMutation({ mutationFn: (response: string) => run<TurnstileResult>('settings turnstile test', { flags: { response } }) })
  return (
    <div className="grid gap-2">
      <p className="text-muted-foreground text-sm">{ready ? t('turnstile.testHint') : t('turnstile.notSaved')}</p>
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={!ready}
        onClick={() => {
          test.reset()
          setRound(round + 1)
        }}
      >
        {t('actions.testTurnstile')}
      </Button>
      {round > 0 && <Turnstile key={round} siteKey={siteKey} onToken={(token) => token && test.mutate(token)} />}
      <ErrorNotice error={test.error} />
      {test.data && (
        <Alert variant={test.data.success ? 'default' : 'destructive'} data-testid="turnstile-result">
          <AlertDescription>
            <p>{test.data.success ? t('turnstile.passed') : t('turnstile.failed')}</p>
            {test.data.error_codes.length > 0 && <p>{t('turnstile.errorCodes', { codes: test.data.error_codes.join(', ') })}</p>}
            {test.data.hostname && <p>{t('turnstile.hostname', { hostname: test.data.hostname })}</p>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}

// UpdateCdnCard 是更新 CDN 的开关：主控自身类危险操作，先确认，确认的值就是要设成的 true 或 false。
function UpdateCdnCard({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('settings')
  const dialogs = useDialogs()
  const write = useSettingsWrite()
  const toggle = async (next: boolean) => {
    const value = String(next)
    const ok = await dialogs.confirm({ title: next ? t('updateCdn.confirmOn') : t('updateCdn.confirmOff'), description: t('updateCdn.confirmDescription'), value, destructive: !next })
    if (ok) write.mutate((rv) => run<SettingsObject>('settings update-cdn set', { args: [value], confirm: value, flags: { 'resource-version': rv } }))
  }
  return (
    <Section title={t('updateCdn.title')} description={t('updateCdn.description')}>
      <div className="grid gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} disabled={write.isPending} onCheckedChange={(v) => void toggle(v)} aria-label={t('updateCdn.enabled')} />
          {t('updateCdn.enabled')}
        </label>
        <WriteError write={write} />
      </div>
    </Section>
  )
}

function SnapshotsCard() {
  const { t } = useTranslation('settings')
  const dialogs = useDialogs()
  const write = useSettingsWrite()
  const list = useInfiniteQuery({
    queryKey: ['settings snapshots list'],
    queryFn: ({ pageParam }) => run<Page<Snapshot>>('settings snapshots list', { limit: 20, cursor: pageParam }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const rollback = async (s: Snapshot) => {
    if (!(await dialogs.confirm({ title: t('snapshots.rollbackTitle', { id: s.id }), description: t('snapshots.rollbackDescription') }))) return
    write.mutate((rv) => run<SettingsObject>('settings rollback', { args: [String(s.id)], flags: { 'resource-version': rv } }))
  }
  return (
    <Section title={t('snapshots.title')} description={t('snapshots.description')}>
      <div className="grid gap-3">
        <ErrorNotice error={list.error} />
        <WriteError write={write} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('snapshots.id')}</TableHead>
              <TableHead>{t('snapshots.objectVersion')}</TableHead>
              <TableHead>{t('snapshots.createdAt')}</TableHead>
              <TableHead>{t('snapshots.source')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && !list.isPending && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  {t('snapshots.empty')}
                </TableCell>
              </TableRow>
            )}
            {items.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.id}</TableCell>
                <TableCell>{s.object_version}</TableCell>
                <TableCell>{new Date(s.created_at).toLocaleString()}</TableCell>
                <TableCell>{s.source}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" disabled={write.isPending} onClick={() => void rollback(s)}>
                    {t('snapshots.rollback')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {list.hasNextPage && (
          <Button variant="outline" className="justify-self-center" onClick={() => void list.fetchNextPage()}>
            {t('snapshots.loadMore')}
          </Button>
        )}
      </div>
    </Section>
  )
}
