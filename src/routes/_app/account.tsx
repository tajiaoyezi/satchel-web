import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { QRCodeSVG } from 'qrcode.react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { run, type Verification } from '@/api/client'
import { accountQuery } from '@/api/queries'
import { useDialogs } from '@/components/dialogs/DialogsProvider'
import { ErrorNotice } from '@/components/ErrorNotice'
import { RecoveryCodes } from '@/components/RecoveryCodes'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/_app/account')({ component: AccountPage })

// 账号页（web-console「账号页」）：改密码、两步验证与恢复码都是人类专属命令，要当场验证；新恢复码只显示一次。
function AccountPage() {
  const { t } = useTranslation('account')
  const account = useQuery(accountQuery)
  const a = account.data
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <ErrorNotice error={account.error} />
      {a && (
        <Card className="shadow-flat">
          <CardHeader>
            <CardTitle>{t('info.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t('info.username')}</dt>
              <dd>{a.username}</dd>
              <dt className="text-muted-foreground">{t('info.role')}</dt>
              <dd>{a.role === 'admin' ? t('roles.admin') : t('roles.user')}</dd>
              <dt className="text-muted-foreground">{t('info.email')}</dt>
              <dd>{a.email || '–'}</dd>
              <dt className="text-muted-foreground">{t('info.totp')}</dt>
              <dd>{a.totp_enabled ? t('on') : t('off')}</dd>
              <dt className="text-muted-foreground">{t('info.recoveryCodes')}</dt>
              <dd>{a.totp_enabled ? a.recovery_codes_remaining : '–'}</dd>
              <dt className="text-muted-foreground">{t('info.sessions')}</dt>
              <dd>{a.sessions}</dd>
            </dl>
            {a.totp_enabled && a.recovery_codes_low && (
              <Alert className="mt-4">
                <AlertDescription>{t('recoveryLow')}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      {a && <ChangePassword totp={a.totp_enabled} />}
      {a && <TwoFactor enabled={a.totp_enabled} />}
    </div>
  )
}

function ChangePassword({ totp }: { totp: boolean }) {
  const { t } = useTranslation('account')
  const queryClient = useQueryClient()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [code, setCode] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation({
    // 当前密码就是当场验证的密码（account set-password 是人类专属命令）
    mutationFn: () => run('account set-password', { flags: { 'new-password': next }, verify: { password: current, code: code.trim() || undefined } }),
    onSuccess: async () => {
      toast.success(t('password.done'))
      setCurrent('')
      setNext('')
      setAgain('')
      setCode('')
      await queryClient.invalidateQueries({ queryKey: accountQuery.queryKey })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (next !== again) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    change.mutate()
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('password.title')}</CardTitle>
        <CardDescription>{t('password.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-sm gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-current">{t('password.current')}</Label>
            <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-new">{t('password.new')}</Label>
            <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pw-again">{t('password.again')}</Label>
            <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          {totp && (
            <div className="grid gap-1.5">
              <Label htmlFor="pw-code">{t('password.code')}</Label>
              <Input id="pw-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          )}
          {mismatch && <p className="text-destructive text-sm">{t('password.mismatch')}</p>}
          <ErrorNotice error={change.error} />
          <Button type="submit" className="justify-self-start" disabled={!current || !next || !again || change.isPending}>
            {t('password.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

interface TotpSecret {
  secret: string
  otpauth_url: string
}

function TwoFactor({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('account')
  const dialogs = useDialogs()
  const queryClient = useQueryClient()
  const [secret, setSecret] = useState<TotpSecret | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountQuery.queryKey })

  const setup = useMutation({
    mutationFn: (verify: Verification) => run<TotpSecret>('account totp setup', { verify }),
    onSuccess: setSecret,
  })
  const confirm = useMutation({
    mutationFn: (verify: Verification) => run<{ recovery_codes: string[] }>('account totp confirm', { flags: { code: code.trim() }, verify }),
    onSuccess: async (res) => {
      setSecret(null)
      setCode('')
      setCodes(res.recovery_codes)
      await refresh()
    },
  })
  const disable = useMutation({
    mutationFn: (verify: Verification) => run('account totp disable', { verify }),
    onSuccess: async () => {
      toast.success(t('totp.disabled'))
      await refresh()
    },
  })
  const regenerate = useMutation({
    mutationFn: (verify: Verification) => run<{ recovery_codes: string[] }>('account recovery-codes regenerate', { verify }),
    onSuccess: async (res) => {
      setCodes(res.recovery_codes)
      await refresh()
    },
  })
  const withVerify = (m: { mutate: (v: Verification) => void }) => async () => {
    const v = await dialogs.verify()
    if (v) m.mutate(v)
  }
  const confirmThen = (title: string, description: string, m: { mutate: (v: Verification) => void }) => async () => {
    if (await dialogs.confirm({ title, description, destructive: true })) await withVerify(m)()
  }
  const error = setup.error ?? confirm.error ?? disable.error ?? regenerate.error

  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('totp.title')}</CardTitle>
        <CardDescription>{enabled ? t('totp.descriptionOn') : t('totp.descriptionOff')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : secret ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void withVerify(confirm)()
            }}
          >
            <p className="text-sm">{t('totp.scan')}</p>
            <div className="bg-white p-3 justify-self-start rounded">
              <QRCodeSVG value={secret.otpauth_url} size={160} />
            </div>
            <p className="text-sm">
              {t('totp.secret')}<code className="font-mono" data-testid="totp-secret">{secret.secret}</code>
            </p>
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor="totp-code">{t('totp.code')}</Label>
              <Input id="totp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button type="submit" className="justify-self-start" disabled={code.trim().length < 6 || confirm.isPending}>
              {t('totp.confirm')}
            </Button>
          </form>
        ) : enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void confirmThen(t('totp.regenerate'), t('totp.regenerateConfirm'), regenerate)()}>
              {t('totp.regenerate')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmThen(t('totp.disable'), t('totp.disableConfirm'), disable)()}>
              {t('totp.disable')}
            </Button>
          </div>
        ) : (
          <Button className="justify-self-start" onClick={() => void withVerify(setup)()}>
            {t('totp.enable')}
          </Button>
        )}
        <ErrorNotice error={error} />
      </CardContent>
    </Card>
  )
}
