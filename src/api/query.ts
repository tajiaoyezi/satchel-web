import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { ApiError } from './client'

// isUnauthenticated 报告一次失败是不是「没有身份」（会话过期或被作废）。
export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'unauthenticated'
}

// createQueryClient 建 React Query 的客户端：任何查询或操作返回 unauthenticated 时调 onUnauthenticated（回登录页，
// web-console「会话与跳转」）。登录页自己的请求带 meta.skipAuthRedirect，它的 unauthenticated 是「用户名或密码不对」。
export function createQueryClient(onUnauthenticated: () => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthenticated(error) && !query.meta?.skipAuthRedirect) onUnauthenticated()
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (isUnauthenticated(error) && !mutation.meta?.skipAuthRedirect) onUnauthenticated()
      },
    }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}
