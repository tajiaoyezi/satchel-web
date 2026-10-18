import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/_app/')({ component: OverviewPage })

interface Partition {
  items: unknown[]
  total: number
}

type Overview = Record<'servers' | 'users' | 'alerts' | 'tasks', Partition>

// 四个分区与各自出现的里程碑（master-overview）：分区的条目写法随交付它的那一站定，在那之前是空的。
const partitions = [
  { key: 'servers', milestone: 'M2' },
  { key: 'users', milestone: 'M3' },
  { key: 'alerts', milestone: 'M4' },
  { key: 'tasks', milestone: 'M4' },
] as const

// 总览首页（web-console「总览首页」）。
function OverviewPage() {
  const { t } = useTranslation('overview')
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => run<Overview>('overview') })
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <ErrorNotice error={overview.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        {partitions.map(({ key, milestone }) => {
          const p = overview.data?.[key]
          return (
            <Card key={key} className="shadow-flat" data-testid={`partition-${key}`}>
              <CardHeader className="flex flex-row items-baseline justify-between">
                <CardTitle>{t(`partitions.${key}`)}</CardTitle>
                <span className="text-2xl font-semibold tabular-nums">{p?.total ?? '–'}</span>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                {p && p.items.length > 0 ? (
                  <ul className="grid gap-1">
                    {p.items.map((item, i) => (
                      <li key={i} className="truncate font-mono text-xs">
                        {JSON.stringify(item)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  t('comesWith', { milestone })
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
