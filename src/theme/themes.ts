// 主题登记表（web-console「主题框架」）：四个主题名都登记，本站只实现扁平；没实现的按扁平显示。
// public/boot.js 里有一份同样的「已实现」清单（首屏脚本不能 import），测试核对两边一致。
export const THEMES = ['flat', 'pixel', 'anime', 'premium'] as const
export type ThemeName = (typeof THEMES)[number]

export const IMPLEMENTED: Record<ThemeName, boolean> = { flat: true, pixel: false, anime: false, premium: false }

export type Mode = 'light' | 'dark' | 'system'

// 浏览器本地存用户的选择，不发给主控。
export const STORAGE_THEME = 'satchel-theme'
export const STORAGE_MODE = 'satchel-mode'

export function isThemeName(v: unknown): v is ThemeName {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v)
}

// effectiveTheme 是实际显示的主题：没实现的落到扁平。
export function effectiveTheme(t: ThemeName): ThemeName {
  return IMPLEMENTED[t] ? t : 'flat'
}
