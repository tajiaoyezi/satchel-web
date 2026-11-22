import { describe, expect, it } from 'vitest'

import { lineDiff, MAX_CELLS } from './diff'

const kinds = (before: string, after: string) => lineDiff(before, after)?.map((l) => `${l.type}:${l.text}`)

// m2-16 design 第 3 条。
describe('lineDiff', () => {
  it('相同的文本全是 same', () => {
    expect(kinds('a\nb', 'a\nb')).toEqual(['same:a', 'same:b'])
  })

  it('只增与只删', () => {
    expect(kinds('', 'a\nb')).toEqual(['add:a', 'add:b'])
    expect(kinds('a\nb', '')).toEqual(['del:a', 'del:b'])
  })

  it('增删交错时保留最长的公共部分', () => {
    expect(kinds('{\n  "a": 1,\n  "b": 2\n}', '{\n  "a": 1,\n  "c": 3,\n  "b": 2\n}')).toEqual(['same:{', 'same:  "a": 1,', 'add:  "c": 3,', 'same:  "b": 2', 'same:}'])
    expect(kinds('x\ny\nz', 'x\nq\nz')).toEqual(['same:x', 'del:y', 'add:q', 'same:z'])
  })

  it('两边行数之积超过上限时不对齐，返回 null', () => {
    const big = Array.from({ length: Math.ceil(Math.sqrt(MAX_CELLS)) + 1 }, (_, i) => `line ${i}`).join('\n')
    expect(lineDiff(big, `${big}\nmore`)).toBeNull()
  })
})
