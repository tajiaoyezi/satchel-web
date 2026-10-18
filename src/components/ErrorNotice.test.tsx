import '@/i18n'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'

import { ErrorNotice } from './ErrorNotice'

// web-console「后端的错误原样显示」：reason 原样显示，有 next 时一并显示。
describe('ErrorNotice', () => {
  it('显示主控的 reason 与 next', () => {
    render(<ErrorNotice error={new ApiError(400, { code: 'bad_request', reason: 'logo 地址只收 / 与 http(s):// 开头', state: {}, next: '改正后重试' })} />)
    expect(screen.getByRole('alert').textContent).toContain('logo 地址只收 / 与 http(s):// 开头')
    expect(screen.getByRole('alert').textContent).toContain('改正后重试')
  })
  it('没有错误时什么都不显示', () => {
    const { container } = render(<ErrorNotice error={null} />)
    expect(container.textContent).toBe('')
  })
})
