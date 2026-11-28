import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ServerPicker, serversQuery } from '../proxy/-shared'
import { SitesTab } from './-sites'
import { ScanTab, TemplatesTab, ValidateTab } from './-tools'

export const Route = createFileRoute('/_app/websites/')({ component: WebsitesPage })

const TABS = ['sites', 'scan', 'validate', 'templates'] as const
type Tab = (typeof TABS)[number]

// 网站页（web-console「网站页」，m2-22 design 第 1 条）：顶部选服务器（默认全部），四个标签页都保留挂载；
// 「模板」第一次打开时才请求。扫描与校验按服务器重新挂载，换了服务器就不留上一台的结果。
function WebsitesPage() {
  const { t } = useTranslation('websites')
  return (
    <AdminPage title={t('title')}>
      <Websites />
    </AdminPage>
  )
}

function Websites() {
  const { t } = useTranslation('websites')
  const servers = useQuery(serversQuery)
  const [serverId, setServerId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('sites')
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(new Set(['sites']))
  const server = servers.data?.items.find((s) => s.id === serverId) ?? null
  const open = (v: string) => {
    setTab(v as Tab)
    setVisited((prev) => new Set(prev).add(v as Tab))
  }
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="websites-server">{t('server.label')}</Label>
        <ServerPicker id="websites-server" label={t('server.label')} value={serverId} onChange={setServerId} allowAll />
      </div>
      <ErrorNotice error={servers.error} />
      <Tabs value={tab} onValueChange={open}>
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="sites" forceMount hidden={tab !== 'sites'}>
          <SitesTab server={server} />
        </TabsContent>
        <TabsContent value="scan" forceMount hidden={tab !== 'scan'}>
          <ScanTab key={serverId ?? 'none'} server={server} />
        </TabsContent>
        <TabsContent value="validate" forceMount hidden={tab !== 'validate'}>
          <ValidateTab key={serverId ?? 'none'} server={server} />
        </TabsContent>
        <TabsContent value="templates" forceMount hidden={tab !== 'templates'}>
          <TemplatesTab enabled={visited.has('templates')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
