// 网页调用的每条命令与它的 REST 方法、路径（master-rest-api 的推导规则：读命令 GET、其余 POST，路径是命令各段，
// 列表命令去掉末尾的 list，位置参数接在后面）。这是网页唯一的命令表：调用封装只认这里的名字，构建时连同页面清单写进
// dist/satchel-web.json，由主控的测试核对与命令表一致（master-web「页面清单与命令表一致」）。
export interface CommandRoute {
  method: 'GET' | 'POST'
  path: string
  list?: boolean // 列表命令：带 limit 与 cursor
  upload?: boolean // 上传类：请求体是文件本身，flag 走查询参数
}

export const commands = {
  'setup status': { method: 'GET', path: '/api/v1/setup/status' },
  'setup init': { method: 'POST', path: '/api/v1/setup/init' },
  'setup restore': { method: 'POST', path: '/api/v1/setup/restore', upload: true },
  overview: { method: 'GET', path: '/api/v1/overview' },
  'account show': { method: 'GET', path: '/api/v1/account/show' },
  'account set-password': { method: 'POST', path: '/api/v1/account/set-password' },
  'account totp setup': { method: 'POST', path: '/api/v1/account/totp/setup' },
  'account totp confirm': { method: 'POST', path: '/api/v1/account/totp/confirm' },
  'account totp disable': { method: 'POST', path: '/api/v1/account/totp/disable' },
  'account recovery-codes regenerate': { method: 'POST', path: '/api/v1/account/recovery-codes/regenerate' },
  'token list': { method: 'GET', path: '/api/v1/token', list: true },
  'token create': { method: 'POST', path: '/api/v1/token/create' },
  'token update': { method: 'POST', path: '/api/v1/token/update/{id}' },
  'token revoke': { method: 'POST', path: '/api/v1/token/revoke/{id}' },
  'mcp status': { method: 'GET', path: '/api/v1/mcp/status', list: true },
  'settings show': { method: 'GET', path: '/api/v1/settings/show' },
  'settings set': { method: 'POST', path: '/api/v1/settings/set' },
  'settings snapshots list': { method: 'GET', path: '/api/v1/settings/snapshots', list: true },
  'settings rollback': { method: 'POST', path: '/api/v1/settings/rollback/{snapshot}' },
  'settings master-url set': { method: 'POST', path: '/api/v1/settings/master-url/set' },
  'settings gates set': { method: 'POST', path: '/api/v1/settings/gates/set' },
  'settings update-cdn set': { method: 'POST', path: '/api/v1/settings/update-cdn/set/{enabled}' },
  'settings turnstile test': { method: 'POST', path: '/api/v1/settings/turnstile/test' },
  'settings image upload': { method: 'POST', path: '/api/v1/settings/image/upload', upload: true },
  'logs list': { method: 'GET', path: '/api/v1/logs', list: true },
  'logs files list': { method: 'GET', path: '/api/v1/logs/files', list: true },
  'schedule list': { method: 'GET', path: '/api/v1/schedule', list: true },
  'schedule runs list': { method: 'GET', path: '/api/v1/schedule/runs', list: true },
  'job list': { method: 'GET', path: '/api/v1/job', list: true },
  'job get': { method: 'GET', path: '/api/v1/job/get/{job}' },
  'audit list': { method: 'GET', path: '/api/v1/audit', list: true },
  'security events list': { method: 'GET', path: '/api/v1/security/events', list: true },
  'security bans list': { method: 'GET', path: '/api/v1/security/bans', list: true },
  'security ban': { method: 'POST', path: '/api/v1/security/ban/{ip}' },
  'security unban': { method: 'POST', path: '/api/v1/security/unban/{ip}' },
  'backup list': { method: 'GET', path: '/api/v1/backup', list: true },
  'backup create': { method: 'POST', path: '/api/v1/backup/create' },
  'backup upload': { method: 'POST', path: '/api/v1/backup/upload', upload: true },
  'backup download': { method: 'POST', path: '/api/v1/backup/download/{name}' },
  'backup restore': { method: 'POST', path: '/api/v1/backup/restore/{name}' },
  'database show': { method: 'GET', path: '/api/v1/database/show' },
  'database test': { method: 'POST', path: '/api/v1/database/test' },
  'database migrate': { method: 'POST', path: '/api/v1/database/migrate' },
  'update check': { method: 'GET', path: '/api/v1/update/check' },
  'update apply': { method: 'POST', path: '/api/v1/update/apply/{version}' },
} as const satisfies Record<string, CommandRoute>

export type CommandName = keyof typeof commands
