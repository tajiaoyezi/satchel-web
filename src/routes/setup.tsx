import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run, upload } from '@/api/client'
import { setupStatusQuery } from '@/api/queries'
import { healthz } from '@/api/session'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { waitForRestart } from '@/lib/restart'

export const Route = createFileRoute('/setup')({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(setupStatusQuery)
    if (status.initialized) throw redirect({ to: '/' })
  },
  component: SetupPage,
})

// 初始化向导（web-console「初始化向导」）：库里没有用户时，建第一个管理员或从备份恢复；导入 mmwx 随 M9。
function SetupPage() {
  const { t } = useTranslation('setup')
  const status = useQuery(setupStatusQuery).data
  const paths = status?.paths ?? {}
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 p-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('intro')}</p>
      </div>
      <Alert>
        <AlertDescription>{t('warning')}</AlertDescription>
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        {paths.create_admin?.available !== false && <CreateAdmin />}
        {paths.restore_backup?.available !== false && <RestoreBackup />}
      </div>
      <Card className="opacity-60">
        <CardHeader>
          <CardTitle>{t('import.title')}</CardTitle>
          <CardDescription>{paths.import_mmwx?.note || t('import.unavailable')}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

function CreateAdmin() {
  const { t } = useTranslation('setup')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [email, setEmail] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const create = useMutation({
    mutationFn: () => run('setup init', { flags: { username, password, email: email.trim() || undefined } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      await navigate({ to: '/' }) // setup init 成功会顺手下发会话，已经登录了
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password !== again) {
      setMismatch(true) // CLI 在本地也做这一项检查（读两遍）
      return
    }
    setMismatch(false)
    create.mutate()
  }
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('create.title')}</CardTitle>
        <CardDescription>{t('create.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit}>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-username">{t('create.username')}</Label>
            <Input id="setup-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-password">{t('create.password')}</Label>
            <Input id="setup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-again">{t('create.passwordAgain')}</Label>
            <Input id="setup-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="setup-email">{t('create.email')}</Label>
            <Input id="setup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {mismatch && <p className="text-destructive text-sm">{t('create.mismatch')}</p>}
          <ErrorNotice error={create.error} />
          <Button type="submit" disabled={!username || !password || !again || create.isPending}>
            {t('create.submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function RestoreBackup() {
  const { t } = useTranslation('setup')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<'idle' | 'restarting' | 'back' | 'stuck'>('idle')
  const restore = useMutation({
    mutationFn: (f: File) => upload('setup restore', f, { onProgress: setProgress }),
    onSuccess: async () => {
      setStage('restarting')
      try {
        await waitForRestart(healthz)
      } catch {
        setStage('stuck') // 等满上限还连不上：说明可能的原因，请人查过后刷新
        return
      }
      setStage('back')
      queryClient.clear()
      await navigate({ to: '/login' })
    },
  })
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('restore.title')}</CardTitle>
        <CardDescription>{t('restore.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="setup-file">{t('restore.file')}</Label>
          <Input id="setup-file" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {restore.isPending && stage === 'idle' && <p className="text-sm">{t('restore.uploading', { percent: Math.round(progress * 100) })}</p>}
        {stage === 'restarting' && (
          <div className="grid gap-1 text-sm">
            <p>{t('restore.restarting')}</p>
            <p className="text-muted-foreground">{t('restore.foreground')}</p>
          </div>
        )}
        {stage === 'back' && <p className="text-sm">{t('restore.back')}</p>}
        {stage === 'stuck' && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{t('restore.stuck')}</AlertDescription>
          </Alert>
        )}
        <ErrorNotice error={restore.error} />
        <Button disabled={!file || restore.isPending} onClick={() => file && restore.mutate(file)}>
          {t('restore.submit')}
        </Button>
      </CardContent>
    </Card>
  )
}
