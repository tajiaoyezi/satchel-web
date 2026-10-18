import '@/i18n'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { accountQuery } from '@/api/queries'
import { adminAccount } from '@/test/server'

import { DialogsProvider, useDialogs } from './DialogsProvider'

function Harness() {
  const dialogs = useDialogs()
  const [out, setOut] = useState('')
  return (
    <div>
      <button onClick={async () => setOut(JSON.stringify(await dialogs.verify()))}>verify</button>
      <button onClick={async () => setOut(String(await dialogs.confirm({ title: '关掉更新 CDN', description: '关掉之后直接走 GitHub', value: 'false' })))}>
        confirm
      </button>
      <output>{out}</output>
    </div>
  )
}

function renderWith(totp: boolean) {
  const qc = new QueryClient()
  qc.setQueryData(accountQuery.queryKey, { ...adminAccount, totp_enabled: totp })
  render(
    <QueryClientProvider client={qc}>
      <DialogsProvider>
        <Harness />
      </DialogsProvider>
    </QueryClientProvider>,
  )
}

// web-console「当场验证与危险操作的确认」：对话框交回的值就是请求要带的值，取消时交回空。
describe('DialogsProvider', () => {
  it('当场验证：没开两步验证时只要密码', async () => {
    const user = userEvent.setup()
    renderWith(false)
    await user.click(screen.getByText('verify'))
    expect(screen.queryByLabelText('两步验证码或恢复码')).toBeNull()
    await user.type(screen.getByLabelText('密码'), 'secret12')
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('{"password":"secret12"}'))
  })

  it('当场验证：开了两步验证时要验证码；取消交回空', async () => {
    const user = userEvent.setup()
    renderWith(true)
    await user.click(screen.getByText('verify'))
    await user.type(screen.getByLabelText('密码'), 'secret12')
    await user.type(screen.getByLabelText('两步验证码或恢复码'), '123456')
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('{"password":"secret12","code":"123456"}'))
    await user.click(screen.getByText('verify'))
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('null'))
    // 再打开时上一次输入的值已经丢了
    await user.click(screen.getByText('verify'))
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('')
  })

  it('危险确认：写明要确认的值，确认交回 true、取消交回 false', async () => {
    const user = userEvent.setup()
    renderWith(false)
    await user.click(screen.getByText('confirm'))
    expect(screen.getByText('要确认的值：false')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('true'))
    await user.click(screen.getByText('confirm'))
    await user.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('false'))
  })
})
