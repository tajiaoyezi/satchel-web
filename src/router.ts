import type { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

// createAppRouter 建网页的路由（测试里换成内存里的 history）。
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, context: { queryClient }, history, defaultPreload: false })
}

// redirectToLogin 是会话过期或被作废时的处理（web-console「会话与跳转」）：清掉缓存，回登录页并记下原来的页面。
// 已经在登录页时什么都不做（登录页自己的失败不跳）。
export function redirectToLogin(router: ReturnType<typeof createAppRouter>, queryClient: QueryClient) {
  if (router.state.location.pathname === '/login') return
  const back = router.state.location.href
  queryClient.clear()
  void router.navigate({ to: '/login', search: { redirect: back } })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
