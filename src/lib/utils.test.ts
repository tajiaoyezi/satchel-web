import { describe, expect, it } from 'vitest'

import { cn } from './utils'

describe('cn', () => {
  it('后面的 Tailwind class 覆盖前面冲突的，假值被忽略', () => {
    const hidden = false
    expect(cn('px-2 text-sm', hidden && 'hidden', 'px-4')).toBe('text-sm px-4')
  })
})
