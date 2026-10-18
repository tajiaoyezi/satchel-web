import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderApp } from '@/test/render'
import { adminAccount, fakeServer } from '@/test/server'

afterEach(() => vi.unstubAllGlobals())

const empty = { items: [], total: 0 }

// web-console「M1 的首页」：四个分区都是 0，各自写着随哪一站出现。
describe('总览首页', () => {
  it('四个分区与各自出现的里程碑', async () => {
    fakeServer({
      'GET /api/v1/setup/status': { body: { initialized: true, paths: {} } },
      'GET /api/v1/account/show': { body: adminAccount },
      'GET /api/v1/overview': { body: { servers: empty, users: empty, alerts: empty, tasks: empty } },
    })
    renderApp('/')
    const servers = await screen.findByTestId('partition-servers')
    await within(servers).findByText('0')
    expect(within(servers).getByText('服务器')).toBeTruthy()
    expect(within(servers).getByText('这一块随 M2 出现')).toBeTruthy()
    expect(within(screen.getByTestId('partition-users')).getByText('这一块随 M3 出现')).toBeTruthy()
    expect(within(screen.getByTestId('partition-alerts')).getByText('这一块随 M4 出现')).toBeTruthy()
    expect(within(screen.getByTestId('partition-tasks')).getByText('这一块随 M4 出现')).toBeTruthy()
  })
})
