import './index.css'
import './i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { createQueryClient } from './api/query'
import { App } from './App'
import { createAppRouter, redirectToLogin } from './router'

// 会话过期或被作废（任何请求返回 unauthenticated）时清掉缓存、回登录页，登录后回到原来的页面（web-console「会话与跳转」）。
const queryClient = createQueryClient(() => redirectToLogin(router, queryClient))
const router = createAppRouter(queryClient)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
)
