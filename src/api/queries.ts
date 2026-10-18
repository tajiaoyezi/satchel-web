import { queryOptions } from '@tanstack/react-query'

import { run } from './client'
import type { Account, SetupStatus } from './types'

export const setupStatusQuery = queryOptions({
  queryKey: ['setup status'],
  queryFn: () => run<SetupStatus>('setup status'),
})

export const accountQuery = queryOptions({
  queryKey: ['account show'],
  queryFn: () => run<Account>('account show'),
})
