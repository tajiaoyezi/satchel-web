import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page, query } from '@/test/ops'
import { renderApp } from '@/test/render'

afterEach(() => vi.unstubAllGlobals())

const records = [
  { id: 3, at: '2026-10-18T02:00:00Z', actor: 'admin', actor_kind: 'user', token_id: 7, command: 'backup create', args_digest: '{"args":[],"flags":{}}', result: 'ok' },
  { id: 2, at: '2026-10-18T01:00:00Z', actor: 'admin', actor_kind: 'user', token_id: null, command: 'settings set', args_digest: '{"flags":{"set":{"telegram_bot_token":"***"}}}', result: 'ok' },
  { id: 1, at: '2026-10-18T00:00:00Z', actor: 'bob', actor_kind: 'user', token_id: null, command: 'backup restore', args_digest: '{}', result: 'forbidden' },
]

// web-console「审计页」的组件部分。
describe('审计页', () => {
  it('按命令前缀过滤：请求带 command=backup，只显示 backup 开头的记录；起始时间转成 RFC 3339', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/audit': (c) => page(records.filter((r) => r.command.startsWith(query(c).get('command') ?? ''))),
    })
    renderApp('/audit')
    expect(await screen.findByTestId('audit-2')).toBeTruthy()
    await user.type(screen.getByLabelText('命令前缀'), 'backup')
    await user.type(screen.getByLabelText('起始时间'), '2026-10-18T08:00')
    await user.click(screen.getByRole('button', { name: '查询' }))
    await waitFor(() => expect(screen.queryByTestId('audit-2')).toBeNull())
    expect(screen.getByTestId('audit-3')).toBeTruthy()
    expect(screen.getByTestId('audit-1')).toBeTruthy()
    const q = query(calls.at(-1)!)
    expect(q.get('command')).toBe('backup')
    expect(q.get('since')).toBe(new Date('2026-10-18T08:00').toISOString())
    expect(screen.getByText('令牌 #7')).toBeTruthy()
    expect(screen.getByText('forbidden')).toBeTruthy()
  })

  it('参数摘要默认收起，点开显示格式化的 JSON，打码的值照原样是 ***', async () => {
    const user = userEvent.setup()
    opsServer({ 'GET /api/v1/audit': page(records) })
    renderApp('/audit')
    const row = await screen.findByTestId('audit-2')
    expect(row.textContent).not.toContain('telegram_bot_token')
    await user.click(row.querySelector('button')!)
    expect(row.textContent).toContain('"telegram_bot_token": "***"')
  })
})
