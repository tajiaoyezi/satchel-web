import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'
import { adminAccount, fakeServer } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const codes = ['a1b2c3d4', 'e5f6a7b8', 'c9d0e1f2', 'a3b4c5d6', 'e7f8a9b0', 'c1d2e3f4', 'a5b6c7d8', 'e9f0a1b2']

// web-console「开启两步验证」「改密码」的组件部分：请求形状与恢复码只显示一次。
describe('账号页', () => {
  it('开启两步验证：两次当场验证，确认后恢复码只显示这一次', async () => {
    const user = userEvent.setup()
    let enabled = false
    const calls = fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': () => ({ body: { ...adminAccount, totp_enabled: enabled, recovery_codes_remaining: enabled ? 8 : 0 } }),
      'POST /api/v1/account/totp/setup': { body: { secret: 'JBSWY3DPEHPK3PXP', otpauth_url: 'otpauth://totp/Satchel:admin?secret=JBSWY3DPEHPK3PXP' } },
      'POST /api/v1/account/totp/confirm': () => {
        enabled = true
        return { body: { recovery_codes: codes } }
      },
    })
    renderApp('/account')
    await user.click(await screen.findByRole('button', { name: '开启两步验证' }))
    await user.type(screen.getByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSWY3DPEHPK3PXP')
    await user.type(screen.getByLabelText('验证器当前的码'), '123456')
    await user.click(screen.getByRole('button', { name: '确认开启' }))
    await user.type(await screen.findByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    const shown = await screen.findByTestId('recovery-codes')
    expect(within(shown).getAllByRole('listitem').map((li) => li.textContent)).toEqual(codes)
    expect(calls.find((c) => c.url === '/api/v1/account/totp/setup')?.body).toEqual({ 'verify-password': 'secret12' })
    expect(calls.find((c) => c.url === '/api/v1/account/totp/confirm')?.body).toEqual({ code: '123456', 'verify-password': 'secret12' })
    await user.click(screen.getByRole('button', { name: '我已保存' }))
    await waitFor(() => expect(screen.queryByTestId('recovery-codes')).toBeNull())
    expect(screen.queryByText(codes[0])).toBeNull()
    expect(await screen.findByRole('button', { name: '关闭两步验证' })).toBeTruthy()
  })

  it('改密码：当前密码作当场验证，新密码输两遍', async () => {
    const user = userEvent.setup()
    const calls = fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': { body: adminAccount },
      'POST /api/v1/account/set-password': { body: { username: 'admin', sessions_revoked: 2 } },
    })
    renderApp('/account')
    await user.type(await screen.findByLabelText('当前密码'), 'secret12')
    await user.type(screen.getByLabelText('新密码（至少 8 个字符）'), 'newpass12')
    await user.type(screen.getByLabelText('再输一次新密码'), 'newpass12')
    await user.click(screen.getByRole('button', { name: '改密码' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/v1/account/set-password')).toBe(true))
    expect(calls.find((c) => c.url === '/api/v1/account/set-password')?.body).toEqual({ 'new-password': 'newpass12', 'verify-password': 'secret12' })
  })
})
