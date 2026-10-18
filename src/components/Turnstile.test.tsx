import '@/i18n'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Turnstile, TURNSTILE_SCRIPT } from './Turnstile'

function script() {
  return document.head.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT}"]`)
}

afterEach(() => {
  delete window.turnstile
  script()?.remove()
})

// design「登录」：脚本加载失败时说明原因并给「重试」，重试加载成功后照常拿 token。
describe('Turnstile', () => {
  it('脚本加载失败时显示原因，重试后拿到 token', async () => {
    const user = userEvent.setup()
    const onToken = vi.fn()
    render(<Turnstile siteKey="1x00000000000000000000AA" onToken={onToken} />)
    script()!.dispatchEvent(new Event('error'))
    expect(await screen.findByRole('alert')).toHaveTextContent('challenges.cloudflare.com')
    expect(onToken).toHaveBeenLastCalledWith('')

    await user.click(screen.getByRole('button', { name: '重试' }))
    window.turnstile = {
      render: (_el: HTMLElement, opts: Record<string, unknown>) => {
        ;(opts.callback as (t: string) => void)('tok-2')
        return 'w2'
      },
      remove: () => {},
    }
    await waitFor(() => expect(script()).toBeTruthy())
    script()!.dispatchEvent(new Event('load'))
    await waitFor(() => expect(onToken).toHaveBeenLastCalledWith('tok-2'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
