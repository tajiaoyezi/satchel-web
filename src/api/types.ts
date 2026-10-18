// 网页用到的几条命令的输出形状（与主控的 JSON 输出一致）。

export interface SetupStatus {
  initialized: boolean
  paths: Record<string, { available: boolean; note?: string }>
}

export interface Account {
  username: string
  role: 'admin' | 'user' | string
  email: string
  nickname: string
  totp_enabled: boolean
  totp_pending: boolean
  recovery_codes_remaining: number
  recovery_codes_low: boolean
  sessions: number
}

export interface Page<T> {
  items: T[]
  total: number
  nextCursor: string
}
