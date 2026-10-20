import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const files = [
  { name: 'satchel.log', size: 2048, modified: '2026-10-18T02:00:00Z', active: true },
  { name: 'satchel-2026-10-17T00-00-00.log', size: 10485760, modified: '2026-10-17T00:00:00Z', active: false },
]
const line = (level: string, msg: string) => ({ time: '2026-10-18T01:00:00Z', level, msg, attrs: { k: 'v' } })

// web-console「日志页」的组件部分：主控按 level 与 file 过滤，页面带上这两个参数并照顺序显示。
describe('日志页', () => {
  it('按级别过滤：请求带 level=warn，只显示 error 与 warn，先 error 后 warn', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/logs/files': page(files),
      'GET /api/v1/logs': (c) => page(query(c).get('level') === 'warn' ? [line('ERROR', 'boom'), line('WARN', 'careful')] : [line('ERROR', 'boom'), line('WARN', 'careful'), line('INFO', 'hello')]),
    })
    renderApp('/logs')
    expect(await screen.findByText('hello')).toBeTruthy()
    await user.click(screen.getByRole('combobox', { name: '级别' }))
    await user.click(await screen.findByRole('option', { name: 'warn 及以上' }))
    await waitFor(() => expect(screen.queryByText('hello')).toBeNull())
    const last = calls.filter((c) => c.url.startsWith('/api/v1/logs?')).at(-1)!
    expect(query(last).get('level')).toBe('warn')
    expect(query(last).get('limit')).toBe('200')
    const shown = within(screen.getByTestId('log-lines'))
      .getAllByText(/boom|careful/)
      .map((el) => el.textContent)
    expect(shown).toEqual(['boom', 'careful'])
    expect(screen.getByText(/符合条件的共 2 行/)).toBeTruthy()
  })

  it('看轮转下来的旧文件：请求带 file=<旧文件名>，显示旧文件里的行', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/logs/files': page(files),
      'GET /api/v1/logs': (c) => page(query(c).get('file') ? [line('INFO', 'from old file')] : [line('INFO', 'current')]),
    })
    renderApp('/logs')
    expect(await screen.findByText('current')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /satchel-2026-10-17T00-00-00\.log/ }))
    expect(await screen.findByText('from old file')).toBeTruthy()
    expect(query(calls.filter((c) => c.url.startsWith('/api/v1/logs?')).at(-1)!).get('file')).toBe('satchel-2026-10-17T00-00-00.log')
    expect(screen.getByText(/10 MB/)).toBeTruthy()
  })

  it('文本过滤按回车才发请求，拆不开的行显示原文', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/logs/files': page(files),
      'GET /api/v1/logs': (c) => page(query(c).get('grep') === 'panic' ? [{ raw: 'panic: something odd' }] : [line('INFO', 'current')]),
    })
    renderApp('/logs')
    await screen.findByText('current')
    const before = calls.length
    await user.type(screen.getByLabelText('包含的文本（区分大小写）'), 'panic')
    expect(calls.length).toBe(before)
    await user.keyboard('{Enter}')
    expect(await screen.findByText('panic: something odd')).toBeTruthy()
  })
})
