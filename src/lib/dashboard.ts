import { useEffect, useState } from 'react'

// 管理员仪表盘的实时推送（node-telemetry 的 GET /api/v1/ws/dashboard；m2-14 design 第 1 条）。它不是命令，
// 只用来少发轮询请求：页面在推送连不上时照旧请求命令。只收不发；会话 Cookie 与同源的 Origin 由浏览器带上。

export interface DashboardServer {
  id: number
  name: string
  connection_mode: string
  status: string
  last_heartbeat: string | null
  ip_address: string | null
  ip_address_v6: string
  core_running: boolean
  core_version: string
  current_upload_speed: number
  current_download_speed: number
  speed_updated_at: string | null
  traffic_source: string
  traffic_stats_mode: string
  include_in_traffic_stats: boolean
  system_rx_cycle: number
  system_tx_cycle: number
  same_host_as_master: boolean
}

export interface DashboardSummary {
  total_servers: number
  connected_servers: number
  offline_servers: number
  pending_servers: number
  total_upload_speed: number
  total_download_speed: number
}

export interface DashboardFrame {
  type: 'realtime'
  timestamp: string
  refresh_interval_ms: number
  servers: DashboardServer[]
  summary: DashboardSummary
}

export interface DashboardFeed {
  frame: DashboardFrame | null // 最后一帧；断开后仍保留，页面在 REST 的新结果回来之前继续用它
  live: boolean // 连接开着并且收到过帧；为 false 时页面回到原来的请求方式
  receivedAt: number // 收到最后一帧时的本地时间（Date.now()），与 React Query 的 dataUpdatedAt 比较哪份更新
}

const PATH = '/api/v1/ws/dashboard'
const MIN_RETRY_MS = 1000
const MAX_RETRY_MS = 30_000
const MIN_STALE_MS = 15_000

// dashboardURL 按当前页面的协议与主机拼推送地址：https 用 wss，否则 ws。
export function dashboardURL(loc: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}${PATH}`
}

// useDashboardFeed 连接推送并保留最新一帧。断开后按 1、2、4… 秒重连（最多 30 秒），收到帧后间隔重置；
// 超过 max(3 × refresh_interval_ms, 15 秒) 没收到帧就当连接已经死了，丢掉它并重连；卸载时关闭、不再重连。
export function useDashboardFeed(): DashboardFeed {
  const [feed, setFeed] = useState<DashboardFeed>({ frame: null, live: false, receivedAt: 0 })
  useEffect(() => {
    let stopped = false
    let current: WebSocket | null = null
    let retryMs = MIN_RETRY_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let staleTimer: ReturnType<typeof setTimeout> | undefined

    const armStale = (intervalMs: number, sock: WebSocket) => {
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => drop(sock), Math.max(3 * intervalMs, MIN_STALE_MS))
    }
    // drop 处理一条连接的结束（对方关闭或判定已死）：只处理当前这条，之后按间隔重连。
    const drop = (sock: WebSocket) => {
      if (current !== sock) return
      current = null
      clearTimeout(staleTimer)
      sock.onmessage = null
      sock.onclose = null
      sock.close()
      setFeed((f) => (f.live ? { ...f, live: false } : f))
      if (stopped) return
      retryTimer = setTimeout(connect, retryMs)
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
    }
    const connect = () => {
      if (stopped) return
      const sock = new WebSocket(dashboardURL())
      current = sock
      armStale(0, sock)
      sock.onmessage = (e: MessageEvent) => {
        let f: Partial<DashboardFrame> | null
        try {
          f = JSON.parse(String(e.data)) as Partial<DashboardFrame>
        } catch {
          return
        }
        if (!f || f.type !== 'realtime' || !Array.isArray(f.servers) || !f.summary) return
        retryMs = MIN_RETRY_MS
        armStale(f.refresh_interval_ms ?? 0, sock)
        setFeed({ frame: f as DashboardFrame, live: true, receivedAt: Date.now() })
      }
      sock.onclose = () => drop(sock)
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      if (current) drop(current)
    }
  }, [])
  return feed
}
