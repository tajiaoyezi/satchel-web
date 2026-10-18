import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

// RecoveryCodes 显示一批新的恢复码：只显示这一次（调用方在 onDone 之后丢掉它们），可以复制与下载成文本文件。
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation('account')
  const text = codes.join('\n') + '\n'
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    toast.success(t('actions.copied', { ns: 'common' }))
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'satchel-recovery-codes.txt'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="grid gap-3" data-testid="recovery-codes">
      <Alert>
        <AlertDescription>{t('codes.warning')}</AlertDescription>
      </Alert>
      <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="bg-muted rounded px-2 py-1">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          {t('codes.copy')}
        </Button>
        <Button variant="outline" onClick={download}>
          {t('codes.download')}
        </Button>
        <Button onClick={onDone}>{t('codes.saved')}</Button>
      </div>
    </div>
  )
}
