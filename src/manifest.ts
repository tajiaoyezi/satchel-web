import type { CommandName } from './api/commands'
import type { SessionEntry } from './api/session-entries'

// 页面清单（master-web「页面清单与命令表一致」）：每一页的「可见操作 → CLI 命令」对照表。页面上能点的每个操作都要在这里，
// 写对应的命令，或者会话入口；文案写资源文件里的 key（命名空间:路径），构建时换成中文写进 dist/satchel-web.json。
// 本站（m1-11）交付这六页，m1-12 加运维页。
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
      { labelKey: 'settings:actions.saveGates', command: 'settings gates set' },
      { labelKey: 'settings:actions.testTurnstile', command: 'settings turnstile test' },
      { labelKey: 'settings:actions.updateCdn', command: 'settings update-cdn set' },
      { labelKey: 'settings:actions.snapshots', command: 'settings snapshots list' },
      { labelKey: 'settings:actions.rollback', command: 'settings rollback' },
    ],
  },
]
