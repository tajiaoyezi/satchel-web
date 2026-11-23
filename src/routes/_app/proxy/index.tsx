import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminPage } from '@/components/AdminPage'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { BatchesTab } from './-batches'
import { InboundsTab } from './-inbounds'
import { OutboundsTab } from './-outbounds'
import { PresetsTab } from './-presets'
import { ReferenceTab } from './-reference'
import { RoutingTab } from './-routing'
import { ServerPicker, serversQuery } from './-shared'

export const Route = createFileRoute('/_app/proxy/')({ component: ProxyPage })

const TABS = ['inbounds', 'outbounds', 'routing', 'presets', 'batches', 'reference'] as const
type Tab = (typeof TABS)[number]

// 代理页（web-console「代理页」，m2-18 design 第 2、3 条；m2-20 design 第 1 条）：顶部选服务器（默认全部），下面六个标签页都保留挂载，
// 切走再回来时表单、生成的凭据与预演结果都还在。
function ProxyPage() {
  const { t } = useTranslation('proxy')
  return (
    <AdminPage title={t('title')}>
      <Proxy />
    </AdminPage>
  )
}

function Proxy() {
  const { t } = useTranslation('proxy')
  const servers = useQuery(serversQuery)
  const [serverId, setServerId] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('inbounds')
  // 打开过的标签页：「预设」与「参考」第一次打开时才请求
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(new Set(['inbounds']))
  const server = servers.data?.items.find((s) => s.id === serverId) ?? null
  const open = (v: string) => {
    setTab(v as Tab)
    setVisited((prev) => new Set(prev).add(v as Tab))
  }
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="proxy-server">{t('server.label')}</Label>
        <ServerPicker id="proxy-server" label={t('server.label')} value={serverId} onChange={setServerId} allowAll />
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
        <TabsContent value="inbounds" forceMount hidden={tab !== 'inbounds'}>
          <InboundsTab server={server} />
        </TabsContent>
        <TabsContent value="outbounds" forceMount hidden={tab !== 'outbounds'}>
          <OutboundsTab server={server} />
        </TabsContent>
        <TabsContent value="routing" forceMount hidden={tab !== 'routing'}>
          <RoutingTab server={server} />
        </TabsContent>
        <TabsContent value="presets" forceMount hidden={tab !== 'presets'}>
          <PresetsTab server={server} enabled={visited.has('presets')} />
        </TabsContent>
        <TabsContent value="batches" forceMount hidden={tab !== 'batches'}>
          <BatchesTab server={server} />
        </TabsContent>
        <TabsContent value="reference" forceMount hidden={tab !== 'reference'}>
          <ReferenceTab enabled={visited.has('reference')} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
