import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const emptyOverview = { body: { servers: { items: [], total: 0 }, users: { items: [], total: 0 }, alerts: { items: [], total: 0 }, tasks: { items: [], total: 0 } } }

// web-console「布局与导航」的「服务器只对管理员显示」。
describe('顶部导航', () => {
  it('管理员：依次是总览、服务器、API 令牌、系统设置，后面是运维菜单', async () => {
    opsServer({ 'GET /api/v1/overview': emptyOverview })
    renderApp('/')
    const nav = await screen.findByRole('navigation')
    await within(nav).findByRole('link', { name: '服务器' })
    const links = within(nav)
      .getAllByRole('link')
      .map((el) => el.textContent)
      .slice(1) // 第一个是品牌
    expect(links).toEqual(['总览', '服务器', 'API 令牌', '系统设置'])
    expect(within(nav).getByRole('button', { name: '运维' })).toBeTruthy()
  })

  it('普通用户：导航里没有服务器', async () => {
    opsServer({ 'GET /api/v1/overview': emptyOverview }, { ...adminAccount, username: 'carol', role: 'user' })
    renderApp('/')
    const nav = await screen.findByRole('navigation')
    await within(nav).findByRole('link', { name: 'API 令牌' })
    expect(within(nav).queryByRole('link', { name: '服务器' })).toBeNull()
  })
})

// web-console「布局与导航」的「管理员的运维菜单」。
describe('运维菜单', () => {
  it('管理员：菜单里按顺序是九个运维页，点「日志」进入 /logs', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/overview': { body: { servers: { items: [], total: 0 }, users: { items: [], total: 0 }, alerts: { items: [], total: 0 }, tasks: { items: [], total: 0 } } },
      'GET /api/v1/logs/files': page([]),
      'GET /api/v1/logs': page([]),
    })
    const { router } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: '运维' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['日志', '定时任务', '长任务', '配置变更', '审计', '安全', '备份与恢复', '数据库', '升级'])
    await user.click(within(menu).getByRole('menuitem', { name: '日志' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/logs'))
    expect(await screen.findByRole('heading', { name: '日志' })).toBeTruthy()
  })
})
