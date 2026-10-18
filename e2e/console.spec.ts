/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

// 端到端测试（web-console「网页的测试」，design 第 13 条）：对一个空库的主控按顺序跑向导、两步验证、两步登录、
// 令牌新建与吊销、改品牌后的登录页、Turnstile 测试配置与登录。各步共用一个浏览器页面与账号，所以串行。
// 每一步结束时核对页面上没有 CSP 违规（securitypolicyviolation）与未处理的脚本错误（pageerror）。

const admin = { username: 'admin', password: 'e2e-pass-1234' }
// Cloudflare 公开的测试 key：组件总是给出 token，siteverify 总是通过。
const TURNSTILE_SITE_KEY = '1x00000000000000000000AA'
const TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'

test.describe.configure({ mode: 'serial' })

let page: Page
let totp: TOTP
let recovery: string[] = []
let plain = ''
const usedCodes = new Set<string>()
const problems: string[] = []

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
  await page.exposeFunction('reportCspViolation', (msg: string) => problems.push(`csp: ${msg}`))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      ;(window as unknown as { reportCspViolation: (m: string) => void }).reportCspViolation(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
})

test.afterEach(() => {
  expect(problems, problems.join('\n')).toEqual([])
})

test.afterAll(async () => {
  await page.close()
})

// freshCode 等到验证器出一个这次还没用过的码：主控 90 秒内不认同一个码第二次。
async function freshCode(): Promise<string> {
  for (;;) {
    const code = totp.generate()
    if (!usedCodes.has(code)) {
      usedCodes.add(code)
      return code
    }
    await page.waitForTimeout(1000)
  }
}

// verify 填当场验证：密码，账号开了两步验证时再填一个码（这里用恢复码，免得等下一个周期）。
async function verify(code?: string) {
  const dialog = page.getByRole('dialog', { name: '当场验证' })
  await dialog.getByLabel('密码').fill(admin.password)
  if (code) await dialog.getByLabel('两步验证码或恢复码').fill(code)
  await dialog.getByRole('button', { name: '确认' }).click()
  await expect(dialog).toBeHidden()
}

async function logout() {
  await page.getByRole('button', { name: '账号' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/login/)
}

async function loginWithSecondStep(code: string) {
  await page.getByLabel('用户名').fill(admin.username)
  await page.getByLabel('密码').fill(admin.password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByLabel('验证码或恢复码').fill(code)
  await page.getByRole('button', { name: '验证' }).click()
  await expect(page.getByRole('link', { name: 'API 令牌' })).toBeVisible()
}

async function whoami(token: string) {
  const res = await fetch(new URL('/api/v1/whoami', test.info().project.use.baseURL), { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

test('空库进向导，建第一个管理员后已登录', async () => {
  await page.goto('/tokens')
  await expect(page).toHaveURL(/\/setup/)
  await page.getByLabel('用户名').fill(admin.username)
  await page.getByLabel('密码', { exact: true }).fill(admin.password)
  await page.getByLabel('再输一次密码').fill(admin.password)
  await page.getByRole('button', { name: '建管理员' }).click()
  await expect(page.getByRole('heading', { name: '总览' })).toBeVisible()
})

test('账号页开启两步验证，恢复码只显示一次', async () => {
  await page.goto('/account')
  await page.getByRole('button', { name: '开启两步验证' }).click()
  await verify()
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim() ?? ''
  totp = new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' })
  await page.getByLabel('验证器当前的码').fill(await freshCode())
  await page.getByRole('button', { name: '确认开启' }).click()
  await verify()
  const codes = page.getByTestId('recovery-codes').getByRole('listitem')
  await expect(codes).toHaveCount(8)
  recovery = await codes.allTextContents()
  await page.getByRole('button', { name: '我已保存' }).click()
  await expect(page.getByTestId('recovery-codes')).toBeHidden()
  await expect(page.getByRole('button', { name: '关闭两步验证' })).toBeVisible()
})

test('退出后两步登录', async () => {
  await logout()
  await loginWithSecondStep(await freshCode())
})

test('新建令牌：明文只显示一次，能用它调 whoami', async () => {
  await page.goto('/tokens')
  await page.getByRole('button', { name: '新建令牌' }).click()
  await page.getByLabel('名字（1 到 64 个字符）').fill('e2e')
  await page.getByRole('button', { name: '保存' }).click()
  await verify(recovery[0])
  plain = (await page.getByTestId('token-plain').textContent())?.trim() ?? ''
  expect(plain).not.toBe('')
  const me = await whoami(plain)
  expect(me.status).toBe(200)
  expect(me.body.token_id).not.toBeNull()
  await page.getByRole('button', { name: '我已保存' }).click()
  await expect(page.getByTestId('token-plain')).toBeHidden()
  await expect(page.getByText(plain)).toHaveCount(0)
})

test('吊销令牌：确认并当场验证后状态是已吊销，明文不再能用', async () => {
  const row = page.getByRole('row', { name: /e2e/ })
  await row.getByRole('button', { name: '吊销令牌' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await verify(recovery[1])
  await expect(row.getByText('已吊销')).toBeVisible()
  const me = await whoami(plain)
  expect(me.status).toBe(401)
  expect(me.body.code).toBe('unauthenticated')
})

test('改品牌后登录页的标题变了', async () => {
  await page.goto('/settings')
  const brand = page.getByLabel('品牌标题（登录页与导航上的名字）')
  await brand.fill('测试面板')
  await page.getByRole('button', { name: '保存品牌与外观' }).click()
  await expect(page.getByText('已保存')).toBeVisible()
  await logout()
  await expect(page.getByText('测试面板')).toBeVisible()
  await page.reload() // 主控注入的首屏也是新值
  await expect(page.getByText('测试面板')).toBeVisible()
})

test('保存 Turnstile 测试 key 后测试配置通过，登录页出现组件并能登录', async () => {
  await loginWithSecondStep(recovery[2])
  await page.goto('/settings')
  await page.getByLabel('site key').fill(TURNSTILE_SITE_KEY)
  await page.getByLabel(/^secret key/).fill(TURNSTILE_SECRET_KEY)
  await page.getByRole('button', { name: '保存门与登录防护' }).click()
  await verify(recovery[3])
  await page.getByRole('button', { name: '测试配置' }).click()
  // 这一步要连 Cloudflare（challenges.cloudflare.com）：失败时先看网络，再看网页。
  await expect(page.getByTestId('turnstile-result')).toContainText('核对通过', { timeout: 30_000 })
  await logout()
  await expect(page.getByTestId('turnstile')).toBeVisible()
  await page.getByLabel('用户名').fill(admin.username)
  await page.getByLabel('密码').fill(admin.password)
  await expect(page.getByRole('button', { name: '登录' })).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByLabel('验证码或恢复码').fill(recovery[4])
  await page.getByRole('button', { name: '验证' }).click()
  await expect(page.getByRole('link', { name: 'API 令牌' })).toBeVisible()
})
