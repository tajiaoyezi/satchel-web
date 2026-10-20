import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { accountQuery } from '@/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

// AdminPage 是只对管理员开放的页面的外框（web-console「布局与导航」）：标题，加上管理员看到的内容，或者给普通用户的没有权限的说明。
// 普通用户看不到内容，内容里的查询也不会发；权限始终由主控判定，这里只是不让普通用户看到一页的报错。
export function AdminPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation()
  const isAdmin = useQuery(accountQuery).data?.role === 'admin'
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {isAdmin ? (
        children
      ) : (
        <Alert>
          <AlertTitle>{t('noPermission.title')}</AlertTitle>
          <AlertDescription>{t('noPermission.description')}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
