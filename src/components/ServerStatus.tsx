import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

// ServerSummary 是 server list 的一项（node-channel「server list 与 server get」）。
export interface ServerSummary {
  id: number
  name: string
  connection_mode: string
  status: string
  last_heartbeat: string | null
  ip_address: string | null
  ip_address_v6: string
}

// ServerObject 是 server get 与 server add 返回的资源对象里页面用到的字段；status 里的三把令牌不读、不显示。
export interface ServerObject {
  metadata: { id: number }
  spec: {
    name: string
    connection_mode: string
    domain: string
    domain_v6: string
    listen_port: number
    pull_address: string
    pull_address_v6: string
    pull_port: number
  }
  status: {
    status: string
    last_heartbeat: string | null
    ip_address: string | null
    ip_address_v6: string
    offline_since: string | null
    boot_count: number
    core_running: boolean
    core_version: string
    core_boot_time: string | null
    core_boot_count: number
    fallback_to_pull: boolean
    fallback_at: string | null
    last_pull_at: string | null
    rotation_pending: boolean
    revoke_pending: boolean
    last_rotated_at: string | null
  }
}

const VARIANTS: Record<string, 'default' | 'secondary' | 'destructive'> = { connected: 'default', pending: 'secondary', offline: 'destructive' }

// ServerStatusBadge 显示服务器的在线状态：三种已知状态有中文名，别的值原样显示（web-console「服务器页」）。
export function ServerStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('servers')
  return (
    <Badge variant={VARIANTS[status] ?? 'outline'} data-status={status}>
      {t(`statuses.${status}` as 'statuses.pending', { defaultValue: status })}
    </Badge>
  )
}
