import { page } from './ops'

// 代理页测试共用的假数据（m2-18）。

const server = (id: number, name: string) => ({ id, name, connection_mode: 'websocket', status: 'online', last_heartbeat: null, ip_address: null })

export const servers = page([server(1, 'hk-1'), server(2, 'jp-1')])

export const matrix = {
  kernel_version: 'sing-box@v1.14.4',
  native: [
    { protocol: 'vless', display_name: 'VLESS', category: 'proxy', transports: ['tcp', 'ws', 'grpc'], securities: ['none', 'tls', 'reality'], auth_model: 'uuid', required_fields: ['users[].uuid'] },
    { protocol: 'shadowsocks', display_name: 'Shadowsocks', category: 'proxy', transports: ['tcp'], securities: ['none'], auth_model: 'method+password', required_fields: ['method', 'password'], notes: 'SS2022 多用户' },
  ],
  parallel_track: [{ protocol: 'xhttp', status: 'parallel_track', notes: 'XHTTP 归并行协议移植线' }],
  unsupported: ['mKCP（已淘汰）'],
}

export const planView = (patch: object = {}) => ({
  plan_id: 7,
  status: 'pending',
  affected_count: 1,
  expires_at: '2026-11-22T10:10:00Z',
  created_at: '2026-11-22T10:00:00Z',
  required_dangers: [],
  objects: [{ op: 'create', kind: 'Inbound', name: 'ss-8443', field_diff: { port: { before: null, after: 8443 } } }],
  servers: [],
  ...patch,
})
