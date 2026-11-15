import '@/i18n'

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { RecoveryCodes } from './RecoveryCodes'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecoveryCodes', () => {
  it('下载恢复码时延迟 1000ms 再释放 Object URL', () => {
    vi.useFakeTimers()
    const revoke = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:codes'), revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<RecoveryCodes codes={['aaaa-1111', 'bbbb-2222']} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '下载成文本文件' }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(999)
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(revoke).toHaveBeenCalledWith('blob:codes')
  })

  it('复制失败时提示错误 toast', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    const errSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')

    render(<RecoveryCodes codes={['aaaa-1111']} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '复制全部' }))

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith('复制失败，请手动选中复制'))
  })
})
