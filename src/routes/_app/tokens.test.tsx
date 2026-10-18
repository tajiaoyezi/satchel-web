import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'
import { adminAccount, fakeServer } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const base = { owner: 'admin', preset: 'readonly', scopes: ['read'], danger: [], runtime: '', expires_at: null, last_used_at: null, created_at: '2026-10-01T00:00:00Z', revoked_at: null, state: 'active' }

// web-console「新建令牌的明文只显示一次」「吊销」的组件部分，以及普通用户签危险类时显示主控的 forbidden。
describe('API 令牌页', () => {
  it('新建令牌：当场验证后明文只显示这一次', async () => {
    const user = userEvent.setup()
    const calls = fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': { body: adminAccount },
      'GET /api/v1/token': { body: { items: [], nextCursor: '' } },
      'POST /api/v1/token/create': { body: { ...base, id: 1, name: 'ci', token: 'sat_plain_once' } },
    })
    renderApp('/tokens')
    await user.click(await screen.findByRole('button', { name: '新建令牌' }))
    await user.type(screen.getByLabelText('名字（1 到 64 个字符）'), 'ci')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByTestId('token-plain')).toHaveTextContent('sat_plain_once')
    expect(calls.find((c) => c.url === '/api/v1/token/create')?.body).toEqual({ name: 'ci', preset: 'readonly', 'verify-password': 'secret12' })
    await user.click(screen.getByRole('button', { name: '我已保存' }))
    await waitFor(() => expect(screen.queryByTestId('token-plain')).toBeNull())
    expect(screen.queryByText('sat_plain_once')).toBeNull()
  })

  it('吊销：说明不能恢复，确认并验证后列表显示已吊销', async () => {
    const user = userEvent.setup()
    let revoked = false
    const calls = fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': { body: adminAccount },
      'GET /api/v1/token': () => ({ body: { items: [{ ...base, id: 3, name: 'old', state: revoked ? 'revoked' : 'active' }], nextCursor: '' } }),
      'POST /api/v1/token/revoke/3': () => {
        revoked = true
        return { body: { ...base, id: 3, name: 'old', state: 'revoked' } }
      },
    })
    renderApp('/tokens')
    await user.click(await screen.findByRole('button', { name: '吊销令牌' }))
    expect(await screen.findByText('吊销后立刻失效，不能恢复。')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText('已吊销')).toBeTruthy()
    expect(calls.find((c) => c.url === '/api/v1/token/revoke/3')?.body).toEqual({ 'verify-password': 'secret12' })
  })

  it('普通用户签危险类：显示主控的 forbidden', async () => {
    const user = userEvent.setup()
    fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': { body: { ...adminAccount, username: 'bob', role: 'user' } },
      'GET /api/v1/token': { body: { items: [], nextCursor: '' } },
      'POST /api/v1/token/create': { status: 403, body: { code: 'forbidden', reason: '普通用户不能签危险类', state: {}, next: '' } },
    })
    renderApp('/tokens')
    expect(screen.queryByLabelText('只看这个签发者的')).toBeNull()
    await user.click(await screen.findByRole('button', { name: '新建令牌' }))
    await user.type(screen.getByLabelText('名字（1 到 64 个字符）'), 'x')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByText(/普通用户不能签危险类/)).toBeTruthy()
  })
})
