import fs from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { IMPLEMENTED, STORAGE_MODE, STORAGE_THEME } from './themes'

// 测试在 satchel-web 的根目录下跑（jsdom 环境里 import.meta.url 不是 file: 地址）。
const code = fs.readFileSync(path.resolve(process.cwd(), 'public/boot.js'), 'utf8')

interface Case {
  boot?: Record<string, string>
  theme?: string
  mode?: string
  systemDark?: boolean
}

// runBoot 在 jsdom 里按给定的启动配置、本地存储与系统亮暗跑一遍 boot.js，返回它给 <html> 设的主题与亮暗。
function runBoot({ boot = {}, theme, mode, systemDark = false }: Case) {
  const root = document.documentElement
  root.removeAttribute('data-theme')
  root.classList.remove('dark')
  document.head.innerHTML = `<script id="satchel-boot" type="application/json">${JSON.stringify(boot)}</script>`
  localStorage.clear()
  if (theme) localStorage.setItem(STORAGE_THEME, theme)
  if (mode) localStorage.setItem(STORAGE_MODE, mode)
  window.matchMedia = ((q: string) => ({ matches: systemDark && q.includes('dark') })) as unknown as typeof window.matchMedia
  new Function(code)()
  return { theme: root.getAttribute('data-theme'), dark: root.classList.contains('dark') }
}

afterEach(() => localStorage.clear())

// web-console「默认主题与用户的选择」「还没实现的主题」的首屏部分。
describe('boot.js', () => {
  it('没存过选择时用主控注入的默认主题，亮暗跟随系统', () => {
    expect(runBoot({ boot: { default_theme: 'flat' }, systemDark: true })).toEqual({ theme: 'flat', dark: true })
    expect(runBoot({ boot: { default_theme: 'flat' }, systemDark: false })).toEqual({ theme: 'flat', dark: false })
  })
  it('存过的选择优先于默认值与系统', () => {
    expect(runBoot({ boot: { default_theme: 'flat' }, mode: 'light', systemDark: true })).toEqual({ theme: 'flat', dark: false })
    expect(runBoot({ mode: 'dark', systemDark: false })).toEqual({ theme: 'flat', dark: true })
  })
  it('还没实现的主题按扁平显示', () => {
    expect(runBoot({ boot: { default_theme: 'pixel' } }).theme).toBe('flat')
    expect(runBoot({ theme: 'premium' }).theme).toBe('flat')
  })
  it('启动配置坏了也不出错', () => {
    document.head.innerHTML = '<script id="satchel-boot" type="application/json">__SATCHEL_BOOT__</script>'
    expect(() => new Function(code)()).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('flat')
  })
  it('已实现的主题与 themes.ts 一致', () => {
    const m = /var implemented = (\{[^}]*\})/.exec(code)
    const inBoot = Object.keys(new Function(`return ${m?.[1]}`)() as Record<string, boolean>).sort()
    const inThemes = Object.entries(IMPLEMENTED)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort()
    expect(inBoot).toEqual(inThemes)
  })
})
