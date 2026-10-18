import { useTranslation } from 'react-i18next'

import { ApiError } from '@/api/client'
import { Alert, AlertDescription } from '@/components/ui/alert'

// ErrorNotice 显示一次失败：主控的 reason 原样，有 next 时另起一行（web-console「只经命令表的接口」）。
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation()
  if (!error) return null
  const reason = error instanceof ApiError ? error.body.reason : error instanceof Error ? error.message : ''
  const next = error instanceof ApiError ? error.body.next : ''
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription>
        <p>{reason || t('errors.unknown')}</p>
        {next && <p>{t('errors.next', { next })}</p>}
      </AlertDescription>
    </Alert>
  )
}
