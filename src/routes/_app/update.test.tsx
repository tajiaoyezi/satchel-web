import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, query } from '@/test/ops'
import { renderApp } from '@/test/render'
import type { FakeCall } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const check = (patch: object = {}) => ({
  body: {
    current_version: '0.1.0',
    latest_version: '0.1.1',
    has_update: true,
    channel: 'stable',
    prerelease: false,
    release_url: 'https://github.com/satchel/satchel/releases/tag/v0.1.1',
    notes: '<b>修了几个问题</b>',
    source: 'cdn',
    cdn: { enabled: true, used: true },
    can_apply: true,
    ...patch,
  },
})
const accepted = { job_id: 'job-u', kind: 'update apply', status: 'queued', created_at: '2026-10-18T00:00:00Z', output: null, output_truncated: false }

// web-console「升级页」的组件部分。
describe('升级页', () => {
  it('有新版本：显示新版本与「升级到 0.1.1」；发布说明按纯文本显示', async () => {
    opsServer({ 'GET /api/v1/update/check': check() })
    renderApp('/update')
    expect(await screen.findByText('最新版本：0.1.1')).toBeTruthy()
    expect(screen.getByRole('button', { name: '升级到 0.1.1' })).toBeTruthy()
    expect(screen.getByText('<b>修了几个问题</b>')).toBeTruthy()
    expect(screen.getByRole('link', { name: '发布页' })).toHaveAttribute('rel', 'noreferrer')
  })

  it('升级要确认版本号：确认对话框里是版本号，请求是 POST /api/v1/update/apply/0.1.1，confirm 为 0.1.1', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/update/check': check(),
      'POST /api/v1/update/apply/0.1.1': { body: accepted },
      'GET /api/v1/job/get/job-u': { body: { ...accepted, status: 'running', progress: { phase: 'downloading', source: 'cdn', bytes: 1048576, total: 4194304 } } },
    })
    renderApp('/update')
    await user.click(await screen.findByRole('button', { name: '升级到 0.1.1' }))
    expect(await screen.findByText('要确认的值：0.1.1')).toBeTruthy()
    expect(calls.some((c: FakeCall) => c.url.includes('/update/apply/'))).toBe(false)
    await user.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(calls.some((c: FakeCall) => c.url === '/api/v1/update/apply/0.1.1')).toBe(true))
    expect(calls.find((c: FakeCall) => c.url === '/api/v1/update/apply/0.1.1')?.body).toEqual({ channel: 'stable', confirm: '0.1.1' })
    expect(await screen.findByText('已下载 1.0 MB / 4.0 MB', {}, { timeout: 3000 })).toBeTruthy()
  })

  it('不能自升级：没有升级按钮，显示 reason', async () => {
    opsServer({ 'GET /api/v1/update/check': check({ can_apply: false, reason: '在 Docker 里运行：改 .env 里的镜像 tag 再 docker compose up -d' }) })
    renderApp('/update')
    expect(await screen.findByText(/在 Docker 里运行：改 \.env 里的镜像 tag/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /升级到/ })).toBeNull()
  })

  it('升级成功后提示刷新：显示从哪个版本升到了哪个版本与「刷新页面」', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/update/check': check(),
      'POST /api/v1/update/apply/0.1.1': { body: accepted },
      'GET /api/v1/job/get/job-u': { body: { ...accepted, status: 'done', output: JSON.stringify({ from_version: '0.1.0', to_version: '0.1.1', backup: 'before-upgrade-1.zip' }) } },
    })
    renderApp('/update')
    await user.click(await screen.findByRole('button', { name: '升级到 0.1.1' }))
    await user.click(await screen.findByRole('button', { name: '确认' }))
    expect(await screen.findByText(/已从 0\.1\.0 升级到 0\.1\.1/, {}, { timeout: 3000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeTruthy()
  })

  it('切换渠道重新检查；update check 失败时原样显示 reason', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/update/check': (c: FakeCall) =>
        query(c).get('channel') === 'prerelease' ? { status: 503, body: { code: 'unavailable', reason: '更新 CDN 与 GitHub 都取不到版本信息', state: {}, next: '' } } : check(),
    })
    renderApp('/update')
    await screen.findByText('最新版本：0.1.1')
    await user.click(screen.getByRole('combobox', { name: '渠道' }))
    await user.click(await screen.findByRole('option', { name: 'prerelease（预发布）' }))
    expect(await screen.findByText('更新 CDN 与 GitHub 都取不到版本信息')).toBeTruthy()
    expect(query(calls.at(-1)!).get('channel')).toBe('prerelease')
  })
})
