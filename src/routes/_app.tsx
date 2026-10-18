import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

import { accountQuery, setupStatusQuery } from '@/api/queries'
import { isUnauthenticated } from '@/api/query'
import { TopNav } from '@/components/layout/TopNav'

// 登录后的页面共用的布局与守卫（web-console「会话与跳转」）：库里还没有用户去初始化向导，没登录去登录页并记下要回的地方。
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery)
    if (!status.initialized) throw redirect({ to: '/setup' })
    try {
      await context.queryClient.ensureQueryData({ ...accountQuery, meta: { skipAuthRedirect: true } })
    } catch (e) {
      if (isUnauthenticated(e)) throw redirect({ to: '/login', search: { redirect: location.href } })
      throw e
    }
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
