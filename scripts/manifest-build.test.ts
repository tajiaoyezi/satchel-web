import { describe, expect, it } from 'vitest'

import type { PageDef } from '../src/manifest'
import { buildManifest } from './manifest-build'

const texts: Record<string, string> = { 'a:title': '甲页', 'a:act': '列出', 'a:login': '登录' }
const text = (k: string) => texts[k]

const pages: PageDef[] = [
  {
    id: 'a',
    path: '/a',
    titleKey: 'a:title',
    actions: [
      { labelKey: 'a:act', command: 'token list' },
      { labelKey: 'a:login', session: 'login' },
    ],
  },
]

// 构建时合成 dist/satchel-web.json：文案换成中文，命令带上方法与路径；问题让构建失败。
describe('buildManifest', () => {
  it('合成清单', () => {
    const { manifest, problems } = buildManifest({ version: 'v0.1.0', pages, commands: { 'token list': { method: 'GET', path: '/api/v1/token', list: true } }, text })
    expect(problems).toEqual([])
    expect(manifest).toEqual({
      version: 'v0.1.0',
      pages: [{ id: 'a', path: '/a', title: '甲页', actions: [{ label: '列出', command: 'token list' }, { label: '登录', session: 'login' }] }],
      commands: { 'token list': { method: 'GET', path: '/api/v1/token' } },
    })
  })

  it('报出命令不在命令表、命令没有页面用、文案 key 不存在', () => {
    const bad: PageDef[] = [{ ...pages[0], titleKey: 'a:missing', actions: [{ labelKey: 'a:act', command: 'token revoke' }] }]
    const { problems } = buildManifest({ version: 'dev', pages: bad, commands: { 'token list': { method: 'GET', path: '/api/v1/token' } }, text })
    expect(problems.join('\n')).toContain('a:missing')
    expect(problems.join('\n')).toContain('token revoke 不在 src/api/commands.ts 里')
    expect(problems.join('\n')).toContain('命令 token list')
  })
})
