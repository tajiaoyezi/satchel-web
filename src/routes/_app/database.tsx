import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run, type FlagValue, type Verification } from '@/api/client'
import { healthz } from '@/api/session'
import type { Job } from '@/api/types'
import { AdminPage } from '@/components/AdminPage'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { JobProgress } from '@/components/JobProgress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatBytes } from '@/lib/format'
import { waitForRestart } from '@/lib/restart'

export const Route = createFileRoute('/_app/database')({ component: DatabasePage })

// DatabaseInfo 是 database show 的输出：SQLite 有 path 与 size，PostgreSQL 有连接参数（不含密码）。
interface DatabaseInfo {
  driver: 'sqlite' | 'postgres' | string
  path?: string
  size?: number
  host?: string
  port?: number
  name?: string
  user?: string
  sslmode?: string
  password_configured: boolean
  env_override: boolean
}

interface TestResult {
  server_version: string
  empty: boolean
  tables?: string[]
  backup_tools: { ok: boolean; error?: string; next?: string }
}

const SSLMODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'] as const

type Stage = 'idle' | 'restarting' | 'back' | 'stuck'

const databaseShowQuery = { queryKey: ['database show'], queryFn: () => run<DatabaseInfo>('database show') }

// 数据库页（web-console「数据库页」）：当前的数据库；试连 PostgreSQL；从 SQLite 在线迁移（人类专属，先确认再当场验证），跟踪进度，
// 成功后等主控重启再重新读。目标库的密码只放在表单里，随请求发出，不保存。
function DatabasePage() {
  const { t } = useTranslation('database')
  return (
    <AdminPage title={t('title')}>
      <DatabaseBody />
    </AdminPage>
  )
}

function DatabaseBody() {
  const show = useQuery(databaseShowQuery)
  return (
    <>
      <ErrorNotice error={show.error} />
      {show.data && <CurrentCard info={show.data} />}
      {show.data && <MigrateCard info={show.data} />}
    </>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </>
  )
}

function CurrentCard({ info }: { info: DatabaseInfo }) {
  const { t } = useTranslation('database')
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('current.title')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1" data-testid="database-current">
          <Row label={t('current.driver')}>{info.driver}</Row>
          {info.driver === 'sqlite' ? (
            <>
              <Row label={t('current.path')}>
                <span className="font-mono">{info.path}</span>
              </Row>
              <Row label={t('current.size')}>{formatBytes(info.size ?? 0)}</Row>
            </>
          ) : (
            <>
              <Row label={t('current.host')}>{info.host}</Row>
              <Row label={t('current.port')}>{info.port}</Row>
              <Row label={t('current.name')}>{info.name}</Row>
              <Row label={t('current.user')}>{info.user}</Row>
              <Row label={t('current.sslmode')}>{info.sslmode}</Row>
              <Row label={t('current.password')}>{info.password_configured ? t('current.passwordSet') : t('current.passwordUnset')}</Row>
            </>
          )}
        </dl>
        {info.env_override && <p className="text-muted-foreground">{t('current.envOverride')}</p>}
      </CardContent>
    </Card>
  )
}

function MigrateCard({ info }: { info: DatabaseInfo }) {
  const { t } = useTranslation('database')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({ host: '', port: '5432', name: '', user: '', password: '', sslmode: 'prefer' })
  const [job, setJob] = useState<Job | null>(null)
  const [finished, setFinished] = useState(false)
  const [stage, setStage] = useState<Stage>('idle')
  const flags = (): Record<string, FlagValue> => ({
    host: form.host.trim(),
    port: Number(form.port) || undefined,
    name: form.name.trim(),
    user: form.user.trim(),
    password: form.password,
    sslmode: form.sslmode,
  })
  const test = useMutation({ mutationFn: () => run<TestResult>('database test', { flags: flags() }) })
  const migrate = useMutation({
    mutationFn: (verify: Verification) => run<Job>('database migrate', { flags: flags(), verify }),
    onSuccess: (j) => {
      setFinished(false)
      setJob(j)
    },
  })
  // 迁移完成之后主控过几秒退出、由服务管理器拉起来改用 PostgreSQL：等它起来再重新读（会话随迁移一起拷过去了，人还登录着）。
  const afterDone = async (j: Job) => {
    setFinished(true)
    if (j.status !== 'done') return
    setStage('restarting')
    try {
      await waitForRestart(healthz)
    } catch {
      setStage('stuck')
      return
    }
    setStage('back')
    await queryClient.invalidateQueries()
  }
  const unavailable = info.driver !== 'sqlite' ? t('unavailable.postgres') : info.env_override ? t('unavailable.env') : ''
  const onMigrate = async (e: FormEvent) => {
    e.preventDefault()
    if (!(await dialogs.confirm({ title: t('migrateConfirm.title', { host: form.host.trim(), name: form.name.trim() }), description: t('migrateConfirm.description'), confirmLabel: t('migrateConfirm.confirm'), destructive: true }))) return
    const verify = await dialogs.verify()
    if (verify) migrate.mutate(verify)
  }
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })
  const running = migrate.isPending || (job !== null && !finished) || stage === 'restarting'
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('target.title')}</CardTitle>
        <CardDescription>{t('target.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => void onMigrate(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['host', 'port', 'name', 'user'] as const).map((k) => (
              <div key={k} className="grid gap-1.5">
                <Label htmlFor={`db-${k}`}>{t(`target.${k}`)}</Label>
                <Input id={`db-${k}`} inputMode={k === 'port' ? 'numeric' : undefined} value={form[k]} onChange={set(k)} />
              </div>
            ))}
            <div className="grid gap-1.5">
              <Label htmlFor="db-password">{t('target.password')}</Label>
              <Input id="db-password" type="password" autoComplete="off" value={form.password} onChange={set('password')} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t('target.sslmode')}</Label>
              <Select value={form.sslmode} onValueChange={(v) => setForm({ ...form, sslmode: v })}>
                <SelectTrigger aria-label={t('target.sslmode')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SSLMODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ErrorNotice error={test.error} />
          {test.data && <TestView result={test.data} />}
          {unavailable && (
            <Alert>
              <AlertDescription>{unavailable}</AlertDescription>
            </Alert>
          )}
          <ErrorNotice error={migrate.error} />
          {job && (
            <JobProgress
              key={job.job_id}
              accepted={job}
              onFinish={(j) => void afterDone(j)}
              renderDone={(out) => {
                const r = (out ?? {}) as { tables?: number; rows?: number }
                return <p>{t('done', { tables: r.tables ?? 0, rows: r.rows ?? 0 })}</p>
              }}
            />
          )}
          {stage === 'restarting' && (
            <p className="text-sm" role="status">
              {t('restarting')}
            </p>
          )}
          {stage === 'back' && <p className="text-sm">{t('back')}</p>}
          {stage === 'stuck' && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t('stuck')}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!form.host.trim() || test.isPending || running} onClick={() => test.mutate()}>
              {t('test')}
            </Button>
            <Button type="submit" variant="destructive" disabled={unavailable !== '' || !form.host.trim() || running}>
              {t('migrate')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function TestView({ result }: { result: TestResult }) {
  const { t } = useTranslation('database')
  return (
    <Alert data-testid="database-test-result">
      <AlertDescription className="grid gap-1">
        <p>{t('result.version', { version: result.server_version })}</p>
        {result.empty ? (
          <p>{t('result.empty')}</p>
        ) : (
          <div>
            <p>{t('result.notEmpty')}</p>
            <p className="font-mono">{(result.tables ?? []).join(', ')}</p>
          </div>
        )}
        {result.backup_tools.ok ? (
          <p>{t('result.toolsOk')}</p>
        ) : (
          <>
            <p>{t('result.toolsMissing', { error: result.backup_tools.error ?? '' })}</p>
            {result.backup_tools.next && <p>{t('result.toolsNext', { next: result.backup_tools.next })}</p>}
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}
