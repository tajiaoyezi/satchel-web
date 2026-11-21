import { vi } from 'vitest'

import type { DashboardFrame, DashboardServer } from '@/lib/dashboard'

// FakeWebSocket 替掉浏览器的 WebSocket（jsdom 里没有）：测试控制推帧与关闭，并能看到页面开了几条、关了几条。
export class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  closed = false
  onmessage: ((e: MessageEvent) => void) | null = null
  onclose: ((e: CloseEvent) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
  }

  // push 推一帧（对象会转成 JSON 文本）。
  push(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent)
  }

  // serverClose 模拟对方关闭连接。
  serverClose() {
    this.closed = true
    this.onclose?.({} as CloseEvent)
  }

  static latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1)
    if (!ws) throw new Error('页面还没有连接推送')
    return ws
  }
}

export function installFakeWebSocket() {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
}

export const dashboardServer = (name: string, patch: Partial<DashboardServer> = {}): DashboardServer => ({
  id: name.length,
  name,
  connection_mode: 'websocket',
  status: 'connected',
  last_heartbeat: '2026-11-21T10:00:00Z',
  ip_address: '203.0.113.7',
  ip_address_v6: '',
  core_running: true,
  core_version: '1.14.4',
  current_upload_speed: 0,
  current_download_speed: 0,
  speed_updated_at: null,
  traffic_source: 'core',
  traffic_stats_mode: 'both',
  include_in_traffic_stats: true,
  system_rx_cycle: 0,
  system_tx_cycle: 0,
  same_host_as_master: false,
  ...patch,
})

export const dashboardFrame = (servers: DashboardServer[], refresh = 5000): DashboardFrame => ({
  type: 'realtime',
  timestamp: '2026-11-21T10:00:00Z',
  refresh_interval_ms: refresh,
  servers,
  summary: {
    total_servers: servers.length,
    connected_servers: servers.filter((s) => s.status === 'connected').length,
    offline_servers: servers.filter((s) => s.status === 'offline').length,
    pending_servers: servers.filter((s) => s.status === 'pending').length,
    total_upload_speed: servers.reduce((n, s) => n + s.current_upload_speed, 0),
    total_download_speed: servers.reduce((n, s) => n + s.current_download_speed, 0),
  },
})
