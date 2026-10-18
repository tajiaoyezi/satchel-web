import { useQuery } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { Verification } from '@/api/client'
import { accountQuery } from '@/api/queries'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// 当场验证与危险操作的确认（web-console「当场验证与危险操作的确认」）：页面在发请求之前 await 这两个函数。
// 当场验证的值只在这一次用，对话框一关就丢，网页不保存。

export interface ConfirmOptions {
  title: string
  description: string
  value?: string // 要确认的值（危险类命令的 confirm 口径）
  confirmLabel?: string
  destructive?: boolean
}

interface Dialogs {
  verify: () => Promise<Verification | null>
  confirm: (opts: ConfirmOptions) => Promise<boolean>
}

const DialogsContext = createContext<Dialogs | null>(null)

export function DialogsProvider({ children }: { children: ReactNode }) {
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null)
  const verifyResolve = useRef<((v: Verification | null) => void) | null>(null)
  const confirmResolve = useRef<((ok: boolean) => void) | null>(null)

  const verify = useCallback(
    () =>
      new Promise<Verification | null>((resolve) => {
        verifyResolve.current = resolve
        setVerifyOpen(true)
      }),
    [],
  )
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        confirmResolve.current = resolve
        setConfirmOpts(opts)
      }),
    [],
  )
  const finishVerify = (v: Verification | null) => {
    setVerifyOpen(false)
    verifyResolve.current?.(v)
    verifyResolve.current = null
  }
  const finishConfirm = (ok: boolean) => {
    setConfirmOpts(null)
    confirmResolve.current?.(ok)
    confirmResolve.current = null
  }

  const value = useMemo(() => ({ verify, confirm }), [verify, confirm])
  return (
    <DialogsContext.Provider value={value}>
      {children}
      {verifyOpen && <VerifyDialog onDone={finishVerify} />}
      <ConfirmDialog opts={confirmOpts} onDone={finishConfirm} />
    </DialogsContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDialogs(): Dialogs {
  const ctx = useContext(DialogsContext)
  if (!ctx) throw new Error('useDialogs must be used inside DialogsProvider')
  return ctx
}

function VerifyDialog({ onDone }: { onDone: (v: Verification | null) => void }) {
  const { t } = useTranslation()
  const account = useQuery({ ...accountQuery, enabled: false }).data
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [showCode, setShowCode] = useState(false)
  const needCode = account?.totp_enabled === true
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) onDone({ password, code: code.trim() || undefined })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('verify.title')}</DialogTitle>
            <DialogDescription>{t('verify.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="verify-password">{t('verify.password')}</Label>
            <Input id="verify-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {needCode || showCode ? (
            <div className="grid gap-2">
              <Label htmlFor="verify-code">{t('verify.code')}</Label>
              <Input id="verify-code" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              <p className="text-muted-foreground text-xs">{t('verify.codeHint')}</p>
            </div>
          ) : (
            <Button type="button" variant="link" className="justify-start px-0" onClick={() => setShowCode(true)}>
              {t('verify.showCode')}
            </Button>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onDone(null)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={!password}>
              {t('verify.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmDialog({ opts, onDone }: { opts: ConfirmOptions | null; onDone: (ok: boolean) => void }) {
  const { t } = useTranslation()
  return (
    <AlertDialog open={opts !== null} onOpenChange={(open) => !open && onDone(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          <AlertDialogDescription>{opts?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {opts?.value !== undefined && <p className="font-mono text-sm">{t('confirmDialog.value', { value: opts.value })}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onDone(false)}>{t('actions.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => onDone(true)} className={opts?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}>
            {opts?.confirmLabel ?? t('actions.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
