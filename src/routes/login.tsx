import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ApiError } from '@/api/client'
import { setupStatusQuery } from '@/api/queries'
import { captchaConfig, completeTwoFactor, login, type LoginResult } from '@/api/session'
import { readBoot } from '@/boot'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Turnstile } from '@/components/Turnstile'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginSearch {
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery)
    if (!status.initialized) throw redirect({ to: '/setup' })
  },
  component: LoginPage,
})

// 登录页（web-console「登录页」）：品牌来自首屏注入；Turnstile 启用时显示组件；要第二步时转到输验证码或恢复码，
// 第二步失败后票据作废、回到用户名与密码；被限流时显示解锁时间。登录页自己的失败不触发「回登录页」。
function LoginPage() {
  const { t } = useTranslation('login')
  const boot = readBoot()
  const search = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const captcha = useQuery({ queryKey: ['session captcha'], queryFn: captchaConfig, meta: { skipAuthRedirect: true } }).data
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [token, setToken] = useState('')
  const [widgetKey, setWidgetKey] = useState(0)
  const [pending, setPending] = useState('')
  const [code, setCode] = useState('')

  const done = async (res: LoginResult) => {
    if (res.recovery_codes_low) toast.warning(t('recoveryLow'))
    await queryClient.invalidateQueries()
    await navigate({ to: search.redirect || '/' })
  }

  const first = useMutation({
    meta: { skipAuthRedirect: true },
    mutationFn: () => login(username, password, remember, token || undefined),
    onSuccess: async (res) => {
      if (res.two_factor_required && res.pending) {
        setPending(res.pending)
        return
      }
      await done(res)
    },
    onError: () => {
      setToken('')
      setWidgetKey((k) => k + 1) // 一个 token 只能用一次，失败后让组件重新拿
    },
  })
  const second = useMutation({
    meta: { skipAuthRedirect: true },
    mutationFn: () => completeTwoFactor(pending, code.trim()),
    onSuccess: done,
    onError: () => {
      // 第二步验错一次，票据就作废了：回到用户名与密码
      setPending('')
      setCode('')
      setPassword('')
      setToken('')
      setWidgetKey((k) => k + 1)
    },
  })

  const lastError = second.error ?? first.error
  const until = lastError instanceof ApiError && lastError.code === 'rate_limited' ? String(lastError.body.state.until ?? '') : ''
  const needCaptcha = captcha?.enabled === true

  const submitFirst = (e: FormEvent) => {
    e.preventDefault()
    second.reset()
    first.mutate()
  }
  const submitSecond = (e: FormEvent) => {
    e.preventDefault()
    first.reset()
    second.mutate()
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center p-4">
      {boot.login_wallpaper && <img src={boot.login_wallpaper} alt="" className="absolute inset-0 -z-10 size-full object-cover" />}
      <Card className="shadow-flat w-full max-w-sm">
        <CardHeader className="text-center">
          {boot.logo_url && <img src={boot.logo_url} alt="" className="mx-auto mb-2 size-12 object-contain" />}
          <CardTitle className="text-2xl">{boot.brand_title || t('title')}</CardTitle>
          <CardDescription>{pending ? t('twoFactorHint') : t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {pending ? (
            <form className="grid gap-4" onSubmit={submitSecond}>
              <div className="grid gap-2">
                <Label htmlFor="code">{t('code')}</Label>
                <Input id="code" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit" disabled={!code.trim() || second.isPending}>
                {t('verify')}
              </Button>
              <Button type="button" variant="link" onClick={() => setPending('')}>
                {t('back')}
              </Button>
            </form>
          ) : (
            <form className="grid gap-4" onSubmit={submitFirst}>
              <div className="grid gap-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input id="username" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">{t('password')}</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="remember" checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
                <Label htmlFor="remember">{t('rememberMe')}</Label>
              </div>
              {needCaptcha && <Turnstile key={widgetKey} siteKey={captcha.site_key} onToken={setToken} />}
              <Button type="submit" disabled={!username || !password || (needCaptcha && !token) || first.isPending}>
                {first.isPending ? t('submitting') : t('actions.submit')}
              </Button>
            </form>
          )}
          <ErrorNotice error={lastError} />
          {until && <p className="text-muted-foreground text-sm">{t('lockedUntil', { until: new Date(until).toLocaleString() })}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
