import type { QueryClient } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'

import { Toaster } from '@/components/ui/sonner'
import { useTheme } from '@/theme/ThemeProvider'

export interface RouterContext {
  queryClient: QueryClient
}

function Root() {
  const { dark } = useTheme()
  return (
    <>
      <Outlet />
      <Toaster theme={dark ? 'dark' : 'light'} richColors />
    </>
  )
}

export const Route = createRootRouteWithContext<RouterContext>()({ component: Root })
