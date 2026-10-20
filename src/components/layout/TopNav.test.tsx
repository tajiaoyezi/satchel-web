import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

// web-console「布局与导航」的「管理员的运维菜单」。
describe('运维菜单', () => {
  it('管理员：菜单里按顺序是八个运维页，点「日志」进入 /logs', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/overview': { body: { servers: { items: [], total: 0 }, users: { items: [], total: 0 }, alerts: { items: [], total: 0 }, tasks: { items: [], total: 0 } } },
      'GET /api/v1/logs/files': page([]),
      'GET /api/v1/logs': page([]),
    })
    const { router } = renderApp('/')
    await user.click(await screen.findByRole('button', { name: '运维' }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['日志', '定时任务', '长任务', '审计', '安全', '备份与恢复', '数据库', '升级'])
    await user.click(within(menu).getByRole('menuitem', { name: '日志' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/logs'))
    expect(await screen.findByRole('heading', { name: '日志' })).toBeTruthy()
  })
})
