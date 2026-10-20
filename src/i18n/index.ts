import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import account from './locales/zh/account.json'
import audit from './locales/zh/audit.json'
import backups from './locales/zh/backups.json'
import common from './locales/zh/common.json'
import database from './locales/zh/database.json'
import jobs from './locales/zh/jobs.json'
import login from './locales/zh/login.json'
import logs from './locales/zh/logs.json'
import overview from './locales/zh/overview.json'
import schedule from './locales/zh/schedule.json'
import security from './locales/zh/security.json'
import settings from './locales/zh/settings.json'
import setup from './locales/zh/setup.json'
import tokens from './locales/zh/tokens.json'
import update from './locales/zh/update.json'

// 界面文案全部在资源文件里（web-console「文案与 i18n」）：本站只有中文，英文随 M9 补上 en 资源与语言切换。
export const resources = { zh: { common, login, setup, overview, account, tokens, settings, logs, schedule, jobs, audit, security, backups, database, update } } as const

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: (typeof resources)['zh']
  }
}

void i18n.use(initReactI18next).init({
  lng: 'zh',
  fallbackLng: 'zh',
  supportedLngs: ['zh'],
  defaultNS: 'common',
  ns: Object.keys(resources.zh),
  resources,
  interpolation: { escapeValue: false }, // React 自己转义
})

export default i18n
