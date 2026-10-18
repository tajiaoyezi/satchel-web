import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { ThemeProvider, useTheme } from './ThemeProvider'
import { STORAGE_MODE } from './themes'

function Probe() {
  const { theme, mode, dark, setMode, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="state">{`${theme}/${mode}/${dark}`}</span>
      <button onClick={() => setMode('dark')}>dark</button>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setTheme('pixel')}>pixel</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.head.innerHTML = ''
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})

// 运行中切换：选择存进浏览器本地，<html> 跟着变；选了没实现的主题仍按扁平显示。
describe('ThemeProvider', () => {
  it('切换亮暗与主题', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('state').textContent).toBe('flat/system/false')
    act(() => screen.getByText('dark').click())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem(STORAGE_MODE)).toBe('dark')
    act(() => screen.getByText('light').click())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    act(() => screen.getByText('pixel').click())
    expect(screen.getByTestId('state').textContent).toBe('pixel/light/false')
    expect(document.documentElement.getAttribute('data-theme')).toBe('flat')
  })
})
