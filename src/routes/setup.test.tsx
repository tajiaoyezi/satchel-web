import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadPage } from '@/lib/restart'
import { renderApp } from '@/test/render'
import { adminAccount, fakeServer } from '@/test/server'

// 上传走 XMLHttpRequest、等重启要几分钟、整页加载在 jsdom 里做不了：这几步换成假的，只测向导怎么显示。
// 等重启的结局由每个测试自己定（restart.up：主控起来了还是等满上限）。
const restart = vi.hoisted(() => ({ up: false }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), upload: vi.fn(async () => ({})) }))
vi.mock('@/lib/restart', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/restart')>()
  return { ...real, waitForRestart: vi.fn(async () => (restart.up ? undefined : Promise.reject(new real.RestartTimeout()))), loadPage: vi.fn() }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(loadPage).mockClear()
})

const empty = { initialized: false, paths: { create_admin: { available: true }, import_mmwx: { available: false, note: '导入 mmwx 备份随 M9 交付' }, restore_backup: { available: true } } }

// web-console「初始化向导」的组件部分。
describe('初始化向导', () => {
  it('建管理员：成功后已经登录，进首页', async () => {
    const user = userEvent.setup()
    let initialized = false
    const calls = fakeServer({
      'GET /api/v1/setup/status': () => ({ body: initialized ? { ...empty, initialized: true } : empty }),
      'POST /api/v1/setup/init': () => {
        initialized = true
        return { body: { username: 'admin', role: 'admin' } }
      },
      'GET /api/v1/account/show': { body: adminAccount },
      'GET /api/v1/overview': { body: { servers: { items: [], total: 0 }, users: { items: [], total: 0 }, alerts: { items: [], total: 0 }, tasks: { items: [], total: 0 } } },
    })
    const { router } = renderApp('/')
    await user.type(await screen.findByLabelText('用户名'), 'admin')
    await user.type(screen.getByLabelText('密码'), 'secret12')
    await user.type(screen.getByLabelText('再输一次密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '建管理员' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    await screen.findByRole('link', { name: 'API 令牌' })
    expect(calls.find((c) => c.url === '/api/v1/setup/init')?.body).toEqual({ username: 'admin', password: 'secret12' })
  })

  it('两次密码不一致时不提交', async () => {
    const user = userEvent.setup()
    const calls = fakeServer({ 'GET /api/v1/setup/status': { body: empty } })
    renderApp('/setup')
    await user.type(await screen.findByLabelText('用户名'), 'admin')
    await user.type(screen.getByLabelText('密码'), 'secret12')
    await user.type(screen.getByLabelText('再输一次密码'), 'secret13')
    await user.click(screen.getByRole('button', { name: '建管理员' }))
    expect(await screen.findByText('两次输入的密码不一致')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/v1/setup/init')).toBe(false)
    expect(screen.getByText('导入 mmwx 备份随 M9 交付')).toBeTruthy()
  })

  it('恢复后主控起来：整页加载登录页', async () => {
    const user = userEvent.setup()
    restart.up = true
    fakeServer({ 'GET /api/v1/setup/status': { body: empty } })
    renderApp('/setup')
    await user.upload(await screen.findByLabelText('备份文件'), new File(['zip'], 'satchel-backup.zip', { type: 'application/zip' }))
    await user.click(screen.getByRole('button', { name: '上传并恢复' }))
    expect(await screen.findByText('主控已重新起来，正在进入登录页')).toBeTruthy()
    expect(loadPage).toHaveBeenCalledWith('/login')
  })

  it('恢复后等满上限还连不上：停下并说明可能的原因', async () => {
    const user = userEvent.setup()
    restart.up = false
    fakeServer({ 'GET /api/v1/setup/status': { body: empty } })
    renderApp('/setup')
    await user.upload(await screen.findByLabelText('备份文件'), new File(['zip'], 'satchel-backup.zip', { type: 'application/zip' }))
    await user.click(screen.getByRole('button', { name: '上传并恢复' }))
    expect(await screen.findByText(/等了 5 分钟还是连不上主控/)).toBeTruthy()
    expect(screen.queryByText('主控已重新起来，正在进入登录页')).toBeNull()
    expect(loadPage).not.toHaveBeenCalled()
  })
})
