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

// SettingsObject 是 settings show 与各条写命令的输出：整单一个 resourceVersion，spec 是日常运维档，status 是其余各档。
export interface SettingsObject {
  metadata: { resourceVersion: number }
  spec: Record<string, unknown>
  status: Record<string, unknown>
}

export interface Page<T> {
  items: T[]
  total: number
  nextCursor: string
}

// Job 是 job get 与 job list 的一项（master-jobs）。output 是结果的 JSON 文本：done 时是命令的输出，failed 时是四字段错误。
export interface Job {
  job_id: string
  kind: string
  args?: unknown
  status: 'queued' | 'running' | 'done' | 'failed' | 'unknown' | string
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  output: string | null
  output_truncated: boolean
  progress?: Record<string, unknown>
}
