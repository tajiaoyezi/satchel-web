import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { opsServer, page } from '@/test/ops'
import { renderApp } from '@/test/render'
import { adminAccount, unauthenticated, type FakeCall } from '@/test/server'

// 等主控重启要几分钟：换成测试里放行的假函数。
const restart = vi.hoisted(() => ({ release: () => {} }))
vi.mock('@/lib/restart', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/restart')>()),
  waitForRestart: vi.fn(() => new Promise<void>((r) => (restart.release = r))),
}))

afterEach(() => vi.unstubAllGlobals())

const backup = (name: string) => ({ name, size: 3 * 1024 * 1024, created_at: '2026-10-18T00:00:00Z', driver: 'sqlite' })
const old = backup('satchel-backup-20261017T000000Z.zip')
const settingsWith = (lastRestore: unknown) => ({ body: { metadata: { resourceVersion: 4 }, spec: {}, status: { last_restore: lastRestore } } })

const verifyAs = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByLabelText('密码'), 'secret12')
  await user.click(screen.getByRole('button', { name: '确认' }))
}

// web-console「备份与恢复页」的组件部分。
describe('备份与恢复页', () => {
  it('生成备份：跟踪 job 直到 done，列表里多出这份备份', async () => {
    const user = userEvent.setup()
    const list = [old]
    const fresh = backup('satchel-backup-20261018T000000Z.zip')
    const calls = opsServer({
      'GET /api/v1/backup': () => page([...list]),
      'GET /api/v1/settings/show': settingsWith(null),
      'POST /api/v1/backup/create': { body: { job_id: 'job-1', kind: 'backup create', status: 'queued', created_at: '2026-10-18T00:00:00Z', output: null, output_truncated: false } },
      'GET /api/v1/job/get/job-1': () => {
        list.unshift(fresh)
        return { body: { job_id: 'job-1', kind: 'backup create', status: 'done', created_at: '2026-10-18T00:00:00Z', output: JSON.stringify(fresh), output_truncated: false } }
      },
    })
    renderApp('/backups')
    await screen.findByTestId(`backup-${old.name}`)
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(await screen.findByText('排队中')).toBeTruthy()
    expect(await screen.findByText(`生成了 ${fresh.name}`, {}, { timeout: 3000 })).toBeTruthy()
    expect(await screen.findByTestId(`backup-${fresh.name}`)).toBeTruthy()
    expect(calls.filter((c: FakeCall) => c.url === '/api/v1/job/get/job-1')).toHaveLength(1)
    expect(screen.queryByTestId('last-restore')).toBeNull()
  })

  it('下载要当场验证：请求体带 verify-password，浏览器存成以备份名命名的文件', async () => {
    const user = userEvent.setup()
    const calls = opsServer({
      'GET /api/v1/backup': page([old]),
      'GET /api/v1/settings/show': settingsWith(null),
      [`POST /api/v1/backup/download/${old.name}`]: { body: 'PKzip' },
    })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    try {
      renderApp('/backups')
      await user.click(within(await screen.findByTestId(`backup-${old.name}`)).getByRole('button', { name: '下载' }))
      await verifyAs(user)
      await waitFor(() => expect(saved).toEqual([old.name]))
      expect(calls.find((c: FakeCall) => c.url === `/api/v1/backup/download/${old.name}`)?.body).toEqual({ 'verify-password': 'secret12' })
    } finally {
      click.mockRestore()
    }
  })

  it('恢复之后等主控重启：先确认、再当场验证，提示正在重启；主控起来之后会话没了，回到登录页', async () => {
    const user = userEvent.setup()
    let restored = false
    const calls = opsServer({
      'GET /api/v1/account/show': () => (restored ? unauthenticated : { body: adminAccount }),
      'GET /api/v1/backup': page([old]),
      'GET /api/v1/settings/show': settingsWith(null),
      [`POST /api/v1/backup/restore/${old.name}`]: () => {
        restored = true
        return { body: { restarting: true, backup: old.name } }
      },
      'GET /api/v1/session/captcha': { body: { enabled: false, site_key: '' } },
    })
    const { router } = renderApp('/backups')
    await user.click(within(await screen.findByTestId(`backup-${old.name}`)).getByRole('button', { name: '恢复' }))
    expect(await screen.findByText(/恢复码会作废并重发，新码写在主控本机数据目录的 recovery-codes\/ 里/)).toBeTruthy()
    expect(calls.some((c: FakeCall) => c.url.includes('/backup/restore/'))).toBe(false)
    await user.click(screen.getByRole('button', { name: '恢复' }))
    await verifyAs(user)
    expect(await screen.findByText('恢复已受理，主控正在重启…')).toBeTruthy()
    expect(calls.find((c: FakeCall) => c.url === `/api/v1/backup/restore/${old.name}`)?.body).toEqual({ 'verify-password': 'secret12' })
    restart.release()
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })

  it('上一次恢复失败：显示失败与原因', async () => {
    opsServer({
      'GET /api/v1/backup': page([old]),
      'GET /api/v1/settings/show': settingsWith({ source: 'manual', backup: old.name, at: '2026-10-18T00:00:00Z', result: 'failed', error: 'psql 执行备份里的 SQL 失败，事务已回滚' }),
    })
    renderApp('/backups')
    const card = await screen.findByTestId('last-restore')
    expect(within(card).getByText('失败')).toBeTruthy()
    expect(within(card).getByText('原因：psql 执行备份里的 SQL 失败，事务已回滚')).toBeTruthy()
    expect(within(card).getByText('手动恢复')).toBeTruthy()
  })

  it('已有别的操作在进行：原样显示 conflict 的 reason', async () => {
    const user = userEvent.setup()
    opsServer({
      'GET /api/v1/backup': page([old]),
      'GET /api/v1/settings/show': settingsWith(null),
      'POST /api/v1/backup/create': { status: 409, body: { code: 'conflict', reason: '已有一次恢复在进行，同一时刻只能有一次备份或恢复', state: {}, next: '等它结束（job list 可以看）再做' } },
    })
    renderApp('/backups')
    await user.click(await screen.findByRole('button', { name: '生成' }))
    expect(await screen.findByText('已有一次恢复在进行，同一时刻只能有一次备份或恢复')).toBeTruthy()
  })
})
