import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkText } from './check-text.mjs'

// web-console「检查拦住写死的文案」：字符串、模板与 JSX 文本里的中文都报出文件与行；注释、资源文件、测试文件不查。
describe('checkText', () => {
  it('点名写死中文的文件与行', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-text-'))
    fs.mkdirSync(path.join(dir, 'i18n/locales/zh'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'page.tsx'),
      [
        '// 这是注释，不查',
        'export const a = "ok"',
        'export const b = "写死的提示"',
        'export const c = `模板 ${a} 里的字`',
        'export function P() {',
        '  return <p>界面上的字</p>',
        '}',
      ].join('\n'),
    )
    fs.writeFileSync(path.join(dir, 'page.test.tsx'), 'export const t = "测试里可以写"')
    fs.writeFileSync(path.join(dir, 'i18n/locales/zh/x.ts'), 'export default "资源文件"')
    const got = checkText(dir).map((p) => `${path.basename(p.file)}:${p.line}`)
    expect(got).toEqual(['page.tsx:3', 'page.tsx:4', 'page.tsx:6'])
  })
})
