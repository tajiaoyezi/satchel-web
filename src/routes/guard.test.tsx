import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { redirectToLogin } from '@/router'
import { renderApp } from '@/test/render'
import { adminAccount, fakeServer, unauthenticated } from '@/test/server'

const initialized = { body: { initialized: true, paths: {} } }

afterEach(() => vi.unstubAllGlobals())

// web-console「会话与跳转」「布局与导航」。
describe('守卫与导航', () => {
  it('空库进向导', async () => {
    fakeServer({ 'GET /api/v1/setup/status': { body: { initialized: false, paths: {} } } })
    const { router } = renderApp('/tokens')
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'))
  })

  it('没登录去登录页，并记下要回的页面', async () => {
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': unauthenticated })
    const { router } = renderApp('/tokens')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/tokens' })
  })

  it('已经初始化后打开向导回首页', async () => {
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': { body: adminAccount } })
    const { router } = renderApp('/setup')
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('普通用户的导航里没有系统设置，管理员有', async () => {
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': { body: { ...adminAccount, username: 'carol', role: 'user' } } })
    renderApp('/')
    await screen.findByRole('link', { name: 'API 令牌' })
    expect(screen.queryByRole('link', { name: '系统设置' })).toBeNull()
  })

  it('管理员的导航里有系统设置', async () => {
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': { body: adminAccount } })
    renderApp('/')
    expect(await screen.findByRole('link', { name: '系统设置' })).toBeTruthy()
  })

  it('会话被作废时回登录页，登录后回到原页', async () => {
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': { body: adminAccount } })
    const { router, queryClient } = renderApp('/tokens')
    await waitFor(() => expect(router.state.location.pathname).toBe('/tokens'))
    fakeServer({ 'GET /api/v1/setup/status': initialized, 'GET /api/v1/account/show': unauthenticated })
    redirectToLogin(router, queryClient)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toEqual({ redirect: '/tokens' })
  })
})
