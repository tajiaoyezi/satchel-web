import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'

import { DialogsProvider } from './components/dialogs/DialogsProvider'
import { TooltipProvider } from './components/ui/tooltip'
import type { createAppRouter } from './router'
import { ThemeProvider } from './theme/ThemeProvider'

// App 把各层上下文接起来：React Query、主题、当场验证与确认对话框、路由。
export function App({ queryClient, router }: { queryClient: QueryClient; router: ReturnType<typeof createAppRouter> }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <DialogsProvider>
            <RouterProvider router={router} />
          </DialogsProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
