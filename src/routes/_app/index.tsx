import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import { accountQuery } from '@/api/queries'
import { ErrorNotice } from '@/components/ErrorNotice'
import { ServerStatusBadge, type ServerSummary } from '@/components/ServerStatus'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatSpeed } from '@/lib/format'

export const Route = createFileRoute('/_app/')({ component: OverviewPage })

interface Partition<T = unknown> {
  items: T[]
  total: number
}

interface Overview {
  servers: Partition<ServerSummary>
  users: Partition
  alerts: Partition
  tasks: Partition
}

// 服务器分区随 M2 交付，按列表显示（m2-08 design 第 6 条）；另外三个分区的条目写法随交付它们的那一站定，在那之前是空的。
const pending = [
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
        <ServersPartition partition={overview.data?.servers} />
        {pending.map(({ key, milestone }) => {
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

// ServersPartition：名字链接到详情页、状态与地址；total 多于列出的条数时给「查看全部」。主控只对管理员给出服务器，
// 空分区按角色写两种说明（角色只用来选文案）。
function ServersPartition({ partition: p }: { partition: Partition<ServerSummary> | undefined }) {
  const { t } = useTranslation('overview')
  const isAdmin = useQuery(accountQuery).data?.role === 'admin'
  return (
    <Card className="shadow-flat" data-testid="partition-servers">
      <CardHeader className="flex flex-row items-baseline justify-between">
        <CardTitle>{t('partitions.servers')}</CardTitle>
        <span className="text-2xl font-semibold tabular-nums">{p?.total ?? '–'}</span>
      </CardHeader>
      <CardContent className="text-muted-foreground grid gap-2 text-sm">
        {p && p.items.length > 0 && (
          <ul className="grid gap-1.5">
            {p.items.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <Link to="/servers/$name" params={{ name: s.name }} className="text-foreground truncate font-medium hover:underline">
                  {s.name}
                </Link>
                <ServerStatusBadge status={s.status} />
                <span className="ml-auto truncate font-mono text-xs">{s.ip_address || s.ip_address_v6 || t('servers.noAddress')}</span>
                <span className="text-xs whitespace-nowrap tabular-nums" data-testid={`overview-speed-${s.name}`}>
                  {t('servers.speed', { up: formatSpeed(s.current_upload_speed ?? 0), down: formatSpeed(s.current_download_speed ?? 0) })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {p && p.total > p.items.length && (
          <Link to="/servers" className="text-primary justify-self-start hover:underline">
            {t('servers.viewAll', { count: p.total })}
          </Link>
        )}
        {p && p.total === 0 &&
          (isAdmin ? (
            <p>
              {t('servers.empty')}{' '}
              <Link to="/servers" className="text-primary hover:underline">
                {t('servers.add')}
              </Link>
            </p>
          ) : (
            <p>{t('servers.adminOnly')}</p>
          ))}
      </CardContent>
    </Card>
  )
}
