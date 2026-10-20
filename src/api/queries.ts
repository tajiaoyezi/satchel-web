import { queryOptions } from '@tanstack/react-query'

import { run } from './client'
import type { Account, SettingsObject, SetupStatus } from './types'

export const setupStatusQuery = queryOptions({
  queryKey: ['setup status'],
  queryFn: () => run<SetupStatus>('setup status'),
})

export const accountQuery = queryOptions({
  queryKey: ['account show'],
  queryFn: () => run<Account>('account show'),
})

// settingsShowQuery 是 settings show：系统设置页与备份与恢复页（上一次恢复）共用这个查询。
export const settingsShowQuery = queryOptions({
  queryKey: ['settings show'],
  queryFn: () => run<SettingsObject>('settings show'),
})
