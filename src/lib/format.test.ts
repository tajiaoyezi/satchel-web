import { describe, expect, it } from 'vitest'

import { formatBytes, formatSpeed, formatTime } from './format'

describe('formatBytes', () => {
  it('按 1024 进位', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB')
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})

describe('formatSpeed', () => {
  it('每秒字节数加 /s', () => {
    expect(formatSpeed(0)).toBe('0 B/s')
    expect(formatSpeed(2048)).toBe('2.0 KB/s')
    expect(formatSpeed(1024 * 1024)).toBe('1.0 MB/s')
  })
})

describe('formatTime', () => {
  it('空值给空串，认不出的原样给，否则是本地时间', () => {
    expect(formatTime(null)).toBe('')
    expect(formatTime('not a time')).toBe('not a time')
    expect(formatTime('2026-10-18T00:00:00Z')).toBe(new Date('2026-10-18T00:00:00Z').toLocaleString())
  })
})
