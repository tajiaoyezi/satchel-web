import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { commands } from '../src/api/commands'
import { pages, type PageDef } from '../src/manifest'
import { buildManifest } from './manifest-build'

const texts: Record<string, string> = { 'a:title': '甲页', 'a:act': '列出', 'a:login': '登录' }
const text = (k: string) => texts[k]

const samplePages: PageDef[] = [
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

function realLocaleText(key: string): string | undefined {
  const [ns, p] = key.split(':')
  const file = path.resolve(__dirname, `../src/i18n/locales/zh/${ns}.json`)
  if (!fs.existsSync(file)) return undefined
  let v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const part of p.split('.')) v = (v as Record<string, unknown> | undefined)?.[part]
  return typeof v === 'string' ? v : undefined
}

// 构建时合成 dist/satchel-web.json：文案换成中文，命令带上方法与路径；问题让构建失败。
describe('buildManifest', () => {
  it('合成清单', () => {
    const { manifest, problems } = buildManifest({ version: 'v0.1.0', pages: samplePages, commands: { 'token list': { method: 'GET', path: '/api/v1/token', list: true } }, text })
    expect(problems).toEqual([])
    expect(manifest).toEqual({
      version: 'v0.1.0',
      pages: [{ id: 'a', path: '/a', title: '甲页', actions: [{ label: '列出', command: 'token list' }, { label: '登录', session: 'login' }] }],
      commands: { 'token list': { method: 'GET', path: '/api/v1/token' } },
    })
  })

  it('报出命令不在命令表、命令没有页面用、文案 key 不存在', () => {
    const bad: PageDef[] = [{ ...samplePages[0], titleKey: 'a:missing', actions: [{ labelKey: 'a:act', command: 'token revoke' }] }]
    const { problems } = buildManifest({ version: 'dev', pages: bad, commands: { 'token list': { method: 'GET', path: '/api/v1/token' } }, text })
    expect(problems.join('\n')).toContain('a:missing')
    expect(problems.join('\n')).toContain('token revoke 不在 src/api/commands.ts 里')
    expect(problems.join('\n')).toContain('命令 token list')
  })

  it('扫描真实 src/routes 目录通过且无问题', () => {
    const routesDir = path.resolve(__dirname, '../src/routes')
    const { manifest, problems } = buildManifest({ version: 'dev', pages, commands, text: realLocaleText, routesDir })
    expect(problems).toEqual([])
    expect(manifest.pages.length).toBeGreaterThanOrEqual(14)
  })

  it('扫描 routesDir 拦截直接 fetch 与未登记或跨页的 API client 调用，且不误报 refetch', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'satchel-manifest-routes-'))
    try {
      fs.mkdirSync(path.join(tmpDir, '_app'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, '_app/index.tsx'),
        [
          "import { run, upload } from '@/api/client'",
          'export function Index({ check }: { check: { refetch: () => void } }) {',
          '  check.refetch()',
          "  fetch('/api/raw')",
          "  window.fetch('/api/window')",
          "  run('token list')",
          "  upload('unknown cmd', new File([], 'a'))",
          '}',
        ].join('\n'),
      )
      fs.writeFileSync(path.join(tmpDir, '_app/index.test.tsx'), "fetch('/allowed-in-tests')\n")
      fs.writeFileSync(
        path.join(tmpDir, '_app/tokens.tsx'),
        ["import { run as callRun } from '@/api/client'", 'export function Tokens() {', '  return callRun(`token list`)', '}'].join('\n'),
      )

      const fixturePages: PageDef[] = [
        { id: 'overview', path: '/', titleKey: 'a:title', actions: [{ labelKey: 'a:act', command: 'overview' }] },
        { id: 'tokens', path: '/tokens', titleKey: 'a:title', actions: [{ labelKey: 'a:act', command: 'token list' }] },
      ]
      const fixtureCommands = {
        overview: { method: 'GET' as const, path: '/api/v1/overview' },
        'token list': { method: 'GET' as const, path: '/api/v1/token', list: true },
      }

      const { problems } = buildManifest({ version: 'dev', pages: fixturePages, commands: fixtureCommands, text, routesDir: tmpDir })
      const joined = problems.join('\n')
      expect(joined).toContain('直接调用 fetch()')
      expect(joined).toContain('_app/index.tsx:4')
      expect(joined).toContain('_app/index.tsx:5')
      expect(joined).toContain('调用了命令 token list，但未列入页面 overview 的操作清单')
      expect(joined).toContain('调用的命令 unknown cmd 不在 src/api/commands.ts 里')
      expect(joined).not.toContain('refetch')
      expect(joined).not.toContain('_app/index.test.tsx')
      expect(joined).not.toContain('_app/tokens.tsx')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
