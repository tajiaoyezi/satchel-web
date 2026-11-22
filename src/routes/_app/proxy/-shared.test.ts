import { describe, expect, it } from 'vitest'

import { jsonText, parseObject, targetFlags } from './-shared'

// 代理页共用部件的纯函数（m2-18 design 第 5、10 条）。
describe('parseObject', () => {
  it('留空是 undefined（不发这个字段）', () => {
    expect(parseObject('  ')).toEqual({ ok: true, value: undefined })
  })
  it('解析不了时 ok 为假', () => {
    expect(parseObject('{"a":')).toEqual({ ok: false })
  })
  it('不是对象（数组、数字、null）时 ok 为假', () => {
    expect(parseObject('[1]')).toEqual({ ok: false })
    expect(parseObject('3')).toEqual({ ok: false })
    expect(parseObject('null')).toEqual({ ok: false })
  })
  it('对象原样返回', () => {
    expect(parseObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
})

describe('jsonText', () => {
  it('打码、空对象与空值写成空；其余按缩进的 JSON', () => {
    expect(jsonText('***')).toBe('')
    expect(jsonText({})).toBe('')
    expect(jsonText(null)).toBe('')
    expect(jsonText({ network: 'ws' })).toBe('{\n  "network": "ws"\n}')
  })
})

describe('targetFlags', () => {
  it('全部服务器只带 all；否则带 servers 数组', () => {
    expect(targetFlags({ all: true, names: [] })).toEqual({ all: true })
    expect(targetFlags({ all: false, names: ['a,b', 'c'] })).toEqual({ servers: ['a,b', 'c'] })
  })
})
