import type { CommandName } from './api/commands'
import type { SessionEntry } from './api/session-entries'

// 页面清单（master-web「页面清单与命令表一致」）：每一页的「可见操作 → CLI 命令」对照表。页面上能点的每个操作都要在这里，
// 写对应的命令，或者会话入口；文案写资源文件里的 key（命名空间:路径），构建时换成中文写进 dist/satchel-web.json。
// m1-11 交付前六页，m1-12 加八个运维页，m2-07 加服务器页（详情页 /servers/<名字> 属于同一页），m2-10 加节点维护与主控地址迁移，m2-14 加系统信息、网速、日志与流量统计口径，m2-16 加服务器编辑、节点配置、配置变更页与批量门控，m2-18 加代理页（入站与出站）。人类专属命令的错误提示取第一个提供它的页面（master-web），所以这几条只写在它们本来的那一页。
export interface ActionDef {
  labelKey: string
  command?: CommandName
  session?: SessionEntry
}

export interface PageDef {
  id: string
  path: string
  titleKey: string
  actions: ActionDef[]
}

export const pages: PageDef[] = [
  {
    id: 'login',
    path: '/login',
    titleKey: 'login:title',
    actions: [
      { labelKey: 'login:actions.submit', session: 'login' },
      { labelKey: 'login:actions.twoFactor', session: 'two-factor' },
      { labelKey: 'login:actions.captcha', session: 'captcha' },
    ],
  },
  {
    id: 'setup',
    path: '/setup',
    titleKey: 'setup:title',
    actions: [
      { labelKey: 'setup:actions.status', command: 'setup status' },
      { labelKey: 'setup:actions.createAdmin', command: 'setup init' },
      { labelKey: 'setup:actions.restore', command: 'setup restore' },
    ],
  },
  {
    id: 'overview',
    path: '/',
    titleKey: 'overview:title',
    actions: [{ labelKey: 'overview:actions.view', command: 'overview' }],
  },
  {
    id: 'account',
    path: '/account',
    titleKey: 'account:title',
    actions: [
      { labelKey: 'account:actions.show', command: 'account show' },
      { labelKey: 'account:actions.setPassword', command: 'account set-password' },
      { labelKey: 'account:actions.totpSetup', command: 'account totp setup' },
      { labelKey: 'account:actions.totpConfirm', command: 'account totp confirm' },
      { labelKey: 'account:actions.totpDisable', command: 'account totp disable' },
      { labelKey: 'account:actions.regenerate', command: 'account recovery-codes regenerate' },
      { labelKey: 'account:actions.logout', session: 'logout' },
    ],
  },
  {
    id: 'servers',
    path: '/servers',
    titleKey: 'servers:title',
    actions: [
      { labelKey: 'servers:actions.list', command: 'server list' },
      { labelKey: 'servers:actions.add', command: 'server add' },
      { labelKey: 'servers:actions.get', command: 'server get' },
      { labelKey: 'servers:actions.installCommand', command: 'server install-command' },
      { labelKey: 'servers:actions.traffic', command: 'server traffic' },
      { labelKey: 'servers:actions.connections', command: 'server connections' },
      { labelKey: 'servers:actions.limitSet', command: 'server limit set' },
      { labelKey: 'servers:actions.limitClear', command: 'server limit clear' },
      { labelKey: 'servers:actions.kick', command: 'server kick' },
      { labelKey: 'servers:actions.restartKernel', command: 'server restart-kernel' },
      { labelKey: 'servers:actions.tokenShow', command: 'server token show' },
      { labelKey: 'servers:actions.tokenRotate', command: 'server token rotate' },
      { labelKey: 'servers:actions.tokenRevoke', command: 'server token revoke' },
      { labelKey: 'servers:actions.updateCheck', command: 'server update check' },
      { labelKey: 'servers:actions.updateApply', command: 'server update apply' },
      { labelKey: 'servers:actions.updateBatch', command: 'server update batch' },
      { labelKey: 'servers:actions.uninstall', command: 'server uninstall' },
      { labelKey: 'servers:actions.switchPorts', command: 'server switch-listen-port' },
      { labelKey: 'servers:actions.probeMaster', command: 'server probe-master-url' },
      { labelKey: 'servers:actions.systemInfo', command: 'server system-info' },
      { labelKey: 'servers:actions.nics', command: 'server nics' },
      { labelKey: 'servers:actions.speed', command: 'server speed' },
      { labelKey: 'servers:actions.trafficStats', command: 'server traffic-stats set' },
      { labelKey: 'servers:actions.logs', command: 'server logs list' },
      { labelKey: 'servers:actions.logFiles', command: 'server logs files' },
      { labelKey: 'servers:actions.configStatus', command: 'server config status' },
      { labelKey: 'servers:actions.configFiles', command: 'server config files' },
      { labelKey: 'servers:actions.configRead', command: 'server config read' },
      { labelKey: 'servers:actions.configTest', command: 'server config test' },
      { labelKey: 'servers:actions.plan', command: 'plan' },
      { labelKey: 'servers:actions.apply', command: 'apply' },
    ],
  },
  {
    id: 'proxy',
    path: '/proxy',
    titleKey: 'proxy:title',
    actions: [
      { labelKey: 'proxy:actions.servers', command: 'server list' },
      { labelKey: 'proxy:actions.inboundList', command: 'inbound list' },
      { labelKey: 'proxy:actions.inboundGet', command: 'inbound get' },
      { labelKey: 'proxy:actions.inboundBuild', command: 'inbound build' },
      { labelKey: 'proxy:actions.inboundBatchPlan', command: 'inbound batch plan' },
      { labelKey: 'proxy:actions.inboundBatchList', command: 'inbound batch list' },
      { labelKey: 'proxy:actions.outboundList', command: 'outbound list' },
      { labelKey: 'proxy:actions.outboundGet', command: 'outbound get' },
      { labelKey: 'proxy:actions.outboundProbe', command: 'outbound probe' },
      { labelKey: 'proxy:actions.outboundLanding', command: 'outbound landing plan' },
      { labelKey: 'proxy:actions.outboundBatchPlan', command: 'outbound batch plan' },
      { labelKey: 'proxy:actions.outboundBatchList', command: 'outbound batch list' },
      { labelKey: 'proxy:actions.protocols', command: 'inbound protocols' },
      { labelKey: 'proxy:actions.examples', command: 'inbound examples' },
      { labelKey: 'proxy:actions.keygen', command: 'inbound keygen' },
      { labelKey: 'proxy:actions.plan', command: 'plan' },
      { labelKey: 'proxy:actions.apply', command: 'apply' },
    ],
  },
  {
    id: 'tokens',
    path: '/tokens',
    titleKey: 'tokens:title',
    actions: [
      { labelKey: 'tokens:actions.list', command: 'token list' },
      { labelKey: 'tokens:actions.create', command: 'token create' },
      { labelKey: 'tokens:actions.update', command: 'token update' },
      { labelKey: 'tokens:actions.revoke', command: 'token revoke' },
      { labelKey: 'tokens:actions.connections', command: 'mcp status' },
    ],
  },
  {
    id: 'settings',
    path: '/settings',
    titleKey: 'settings:title',
    actions: [
      { labelKey: 'settings:actions.show', command: 'settings show' },
      { labelKey: 'settings:actions.saveBranding', command: 'settings set' },
      { labelKey: 'settings:actions.saveMasterUrl', command: 'settings master-url set' },
      { labelKey: 'settings:actions.migrateMasterUrl', command: 'settings master-url migrate' },
      { labelKey: 'settings:actions.batchThreshold', command: 'settings batch-threshold set' },
      { labelKey: 'settings:actions.saveGates', command: 'settings gates set' },
      { labelKey: 'settings:actions.uploadImage', command: 'settings image upload' },
      { labelKey: 'settings:actions.testTurnstile', command: 'settings turnstile test' },
      { labelKey: 'settings:actions.updateCdn', command: 'settings update-cdn set' },
      { labelKey: 'settings:actions.snapshots', command: 'settings snapshots list' },
      { labelKey: 'settings:actions.rollback', command: 'settings rollback' },
    ],
  },
  {
    id: 'logs',
    path: '/logs',
    titleKey: 'logs:title',
    actions: [
      { labelKey: 'logs:actions.files', command: 'logs files list' },
      { labelKey: 'logs:actions.lines', command: 'logs list' },
    ],
  },
  {
    id: 'schedule',
    path: '/schedule',
    titleKey: 'schedule:title',
    actions: [
      { labelKey: 'schedule:actions.tasks', command: 'schedule list' },
      { labelKey: 'schedule:actions.runs', command: 'schedule runs list' },
    ],
  },
  {
    id: 'jobs',
    path: '/jobs',
    titleKey: 'jobs:title',
    actions: [
      { labelKey: 'jobs:actions.list', command: 'job list' },
      { labelKey: 'jobs:actions.detail', command: 'job get' },
    ],
  },
  {
    id: 'changes',
    path: '/changes',
    titleKey: 'changes:title',
    actions: [
      { labelKey: 'changes:actions.plansList', command: 'plans list' },
      { labelKey: 'changes:actions.plansGet', command: 'plans get' },
      { labelKey: 'changes:actions.plan', command: 'plan' },
      { labelKey: 'changes:actions.apply', command: 'apply' },
      { labelKey: 'changes:actions.snapshotList', command: 'snapshot list' },
      { labelKey: 'changes:actions.snapshotGet', command: 'snapshot get' },
      { labelKey: 'changes:actions.snapshotRollback', command: 'snapshot rollback' },
    ],
  },
  {
    id: 'audit',
    path: '/audit',
    titleKey: 'audit:title',
    actions: [{ labelKey: 'audit:actions.list', command: 'audit list' }],
  },
  {
    id: 'security',
    path: '/security',
    titleKey: 'security:title',
    actions: [
      { labelKey: 'security:actions.bans', command: 'security bans list' },
      { labelKey: 'security:actions.ban', command: 'security ban' },
      { labelKey: 'security:actions.unban', command: 'security unban' },
      { labelKey: 'security:actions.events', command: 'security events list' },
    ],
  },
  {
    id: 'backups',
    path: '/backups',
    titleKey: 'backups:title',
    actions: [
      { labelKey: 'backups:actions.list', command: 'backup list' },
      { labelKey: 'backups:actions.create', command: 'backup create' },
      { labelKey: 'backups:actions.progress', command: 'job get' },
      { labelKey: 'backups:actions.upload', command: 'backup upload' },
      { labelKey: 'backups:actions.download', command: 'backup download' },
      { labelKey: 'backups:actions.restore', command: 'backup restore' },
      { labelKey: 'backups:actions.lastRestore', command: 'settings show' },
    ],
  },
  {
    id: 'database',
    path: '/database',
    titleKey: 'database:title',
    actions: [
      { labelKey: 'database:actions.show', command: 'database show' },
      { labelKey: 'database:actions.test', command: 'database test' },
      { labelKey: 'database:actions.migrate', command: 'database migrate' },
      { labelKey: 'database:actions.progress', command: 'job get' },
    ],
  },
  {
    id: 'update',
    path: '/update',
    titleKey: 'update:title',
    actions: [
      { labelKey: 'update:actions.check', command: 'update check' },
      { labelKey: 'update:actions.apply', command: 'update apply' },
      { labelKey: 'update:actions.progress', command: 'job get' },
    ],
  },
]
