import type { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

// createAppRouter 建网页的路由（测试里换成内存里的 history）。
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, context: { queryClient }, history, defaultPreload: false })
}

// safeRedirect 净化登录后跳回的目标地址，只允许除 /login 以外的站内相对路径（web-console「会话与跳转」）。
export function safeRedirect(raw?: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  try {
    const u = new URL(raw, 'http://satchel.local')
    if (u.origin !== 'http://satchel.local') return '/'
    if (u.pathname === '/login' || u.pathname.startsWith('/login/')) return '/'
    return u.pathname + u.search + u.hash
  } catch {
    return '/'
  }
}

// redirectToLogin 是会话过期或被作废时的处理（web-console「会话与跳转」）：清掉缓存，回登录页并记下原来的页面。
// 已经在登录页时什么都不做（登录页自己的失败不跳）。
export function redirectToLogin(router: ReturnType<typeof createAppRouter>, queryClient: QueryClient) {
  if (router.state.location.pathname === '/login') return
  const back = safeRedirect(router.state.location.href)
  queryClient.clear()
  void router.navigate({ to: '/login', search: { redirect: back } })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
