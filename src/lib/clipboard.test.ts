import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText } from './clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('copyText', () => {
  it('优先调用 navigator.clipboard.writeText 并返回 true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('hello')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('缺少 clipboard 或写入抛错时降级到 execCommand copy', async () => {
    vi.stubGlobal('navigator', {})
    const exec = vi.fn(() => true)
    document.execCommand = exec
    expect(await copyText('fallback-1')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()

    exec.mockClear()
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('not secure context')) } })
    expect(await copyText('fallback-2')).toBe(true)
    expect(exec).toHaveBeenCalledWith('copy')
  })

  it('Clipboard API 与 execCommand 都失败时返回 false 且清理临时节点', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    expect(await copyText('fail')).toBe(false)
    expect(document.querySelector('textarea')).toBeNull()
  })
})
