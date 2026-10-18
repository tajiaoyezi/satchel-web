import '@/i18n'

import { createMemoryHistory } from '@tanstack/react-router'
import { render } from '@testing-library/react'

import { createQueryClient } from '@/api/query'
import { App } from '@/App'
import { createAppRouter, redirectToLogin } from '@/router'

// renderApp 在内存里的 history 上从 path 打开整个网页（守卫、布局与页面都在），返回路由与 React Query 的客户端。
export function renderApp(path: string) {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  // eslint-disable-next-line prefer-const
  let router: ReturnType<typeof createAppRouter>
  const queryClient = createQueryClient(() => redirectToLogin(router, queryClient))
  router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }))
  const utils = render(<App queryClient={queryClient} router={router} />)
  return { ...utils, router, queryClient }
}
