import type { ReactNode } from 'react'

import { run } from '@/api/client'
import type { ServerObject } from '@/components/ServerStatus'

// 详情页各标签页共用的东西（文件名以 - 开头：路由生成器跳过它，构建时的清单扫描照样检查里面的命令调用）。

// 概况与流量的自动刷新间隔（m2-07 design 第 3 条）；连接清单不自动刷新。
export const REFRESH_MS = 10_000

// DEFAULT_PORTS 是端口为 0 时主控用的默认端口（m2-06：管理口 23889，轮询口 23890）。
export const DEFAULT_PORTS = { listen: 23889, pull: 23890 } as const

// serverQuery 是概况、凭据与维护页共用的 server get（同一个 key，只请求一次）。
export const serverQuery = (name: string) => ({
  queryKey: ['server get', name],
  queryFn: () => run<ServerObject>('server get', { args: [name] }),
  refetchInterval: REFRESH_MS,
})

// Fields 是两列的「名称 值」表。
export function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-all">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
