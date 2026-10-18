import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { readBoot } from '@/boot'

import { STORAGE_MODE, STORAGE_THEME, effectiveTheme, isThemeName, type Mode, type ThemeName } from './themes'

interface ThemeState {
  theme: ThemeName // 用户选的主题（没选过是主控的默认主题）
  mode: Mode
  dark: boolean // 当前实际是不是暗色
  setTheme: (t: ThemeName) => void
  setMode: (m: Mode) => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 浏览器禁用了本地存储：只在这一页生效
  }
}

function systemDark(): boolean {
  return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ThemeProvider 管运行中的主题切换；首屏由 public/boot.js 设好，这里接着用同样的规则，选择存在浏览器本地。
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const stored = readStorage(STORAGE_THEME)
    if (isThemeName(stored)) return stored
    const boot = readBoot().default_theme
    return isThemeName(boot) ? boot : 'flat'
  })
  const [mode, setModeState] = useState<Mode>(() => {
    const stored = readStorage(STORAGE_MODE)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  })
  const [sysDark, setSysDark] = useState(systemDark)

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSysDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const dark = mode === 'dark' || (mode === 'system' && sysDark)
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', effectiveTheme(theme))
    root.classList.toggle('dark', dark)
  }, [theme, dark])

  const setTheme = useCallback((t: ThemeName) => {
    writeStorage(STORAGE_THEME, t)
    setThemeState(t)
  }, [])
  const setMode = useCallback((m: Mode) => {
    writeStorage(STORAGE_MODE, m)
    setModeState(m)
  }, [])

  const value = useMemo(() => ({ theme, mode, dark, setTheme, setMode }), [theme, mode, dark, setTheme, setMode])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
