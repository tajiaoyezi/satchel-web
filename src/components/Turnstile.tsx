import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

// Turnstile 组件（master-login-protection）：按需加载 Cloudflare 的脚本并显式渲染；拿到 token 交给 onToken，
// 过期或出错时交回空串。之后组件自己刷新或重试（refresh-expired 与 retry 默认都是 auto），新 token 照样交给 onToken；
// 脚本加载失败时显示原因与「重试」。调用方换 key 让它重新挂载即可换一个 token。主控的 CSP 放行了这个脚本与它的 iframe（master-web）。

export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script')
      s.src = TURNSTILE_SCRIPT
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        loading = null
        s.remove()
        reject(new Error('turnstile script failed to load'))
      }
      document.head.appendChild(s)
    })
  }
  return loading
}

export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })
  useEffect(() => {
    let id: string | undefined
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        id = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        })
      })
      .catch(() => {
        if (cancelled) return
        onTokenRef.current('')
        setFailed(true)
      })
    return () => {
      cancelled = true
      if (id && window.turnstile) window.turnstile.remove(id)
    }
  }, [siteKey, attempt])
  return (
    <>
      <div ref={ref} data-testid="turnstile" />
      {failed && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="grid gap-2">
            <p>{t('turnstile.loadFailed')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setFailed(false)
                setAttempt((n) => n + 1)
              }}
            >
              {t('actions.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
