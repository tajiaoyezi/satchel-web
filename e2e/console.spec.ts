/// <reference lib="dom" />
import fs from 'node:fs'

import { expect, test, type Locator, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

// 端到端测试（web-console「网页的测试」）：对一个空库的主控按顺序跑向导、两步验证、两步登录、令牌新建与吊销、
// 改品牌后的登录页、Turnstile 测试配置与登录，然后是运维：上传 logo、日志、定时任务、生成与下载备份、长任务与审计、
// 封禁与解封，然后是服务器页（含实时推送、系统、日志与流量统计口径、编辑与节点配置）、配置变更页与批量门控，最后是维护页与主控地址迁移（迁移会改主控地址并清空 Turnstile 的 key，必须是最后一步）。恢复备份、数据库迁移与升级会让主控退出（这里没有服务管理器把它拉起来），不在这里跑。
// 各步共用一个浏览器页面与账号，所以串行。每一步结束时核对页面上没有 CSP 违规（securitypolicyviolation）与未处理的脚本错误（pageerror）。

const admin = { username: 'admin', password: 'e2e-pass-1234' }
// 一张 1×1 的 PNG：上传 logo 用。
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
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
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
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

test('上传 logo：保存后登录页的图片加载成功', async ({ browser }) => {
  await page.goto('/settings')
  await page.getByTestId('branding_logo_url-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 })
  await expect(page.getByLabel('logo 地址')).toHaveValue(/^\/public\/uploads\/[0-9a-f]{32}\.png$/)
  const url = await page.getByLabel('logo 地址').inputValue()
  await page.getByRole('button', { name: '保存品牌与外观' }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  // 另开一个没有登录的页面看登录页，不退出当前的会话。
  const anon = await browser.newPage()
  try {
    await anon.goto('/login')
    const logo = anon.locator(`img[src="${url}"]`)
    await expect(logo).toBeVisible()
    await expect.poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0)
  } finally {
    await anon.close()
  }
})

test('日志页看到主控的启动日志', async () => {
  await page.getByRole('button', { name: '运维' }).click()
  await page.getByRole('menuitem', { name: '日志' }).click()
  await expect(page).toHaveURL(/\/logs$/)
  // 到这一步日志可能已经超过一页：按文本过滤出启动的那一行。
  await page.getByLabel('包含的文本（区分大小写）').fill('主控已启动')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByTestId('log-lines').getByText('主控已启动').first()).toBeVisible()
})

test('定时任务页列出 12 个内置任务', async () => {
  await page.goto('/schedule')
  const tasks = page.getByRole('table').first().getByRole('row')
  await expect(tasks).toHaveCount(13) // 表头加 12 行
  await expect(page.getByRole('button', { name: 'audit_cleanup' })).toBeVisible()
})

let backupName = ''

test('生成备份并跟到完成', async () => {
  await page.goto('/backups')
  await page.getByRole('button', { name: '生成', exact: true }).click()
  const done = page.getByText(/^生成了 satchel-backup-\S+\.zip$/)
  await expect(done).toBeVisible({ timeout: 60_000 })
  backupName = ((await done.textContent()) ?? '').replace('生成了 ', '')
  await expect(page.getByTestId(`backup-${backupName}`)).toBeVisible()
})

test('下载备份：当场验证后得到这份备份，大小与主控上的相同', async () => {
  const listed = (await (await page.request.get('/api/v1/backup')).json()) as { items: { name: string; size: number }[] }
  const size = listed.items.find((b) => b.name === backupName)?.size
  expect(size).toBeGreaterThan(0)
  const saving = page.waitForEvent('download')
  await page.getByTestId(`backup-${backupName}`).getByRole('button', { name: '下载' }).click()
  await verify(recovery[5])
  const file = await saving
  expect(file.suggestedFilename()).toBe(backupName)
  expect(fs.statSync(await file.path()).size).toBe(size)
})

test('长任务页与审计页都看到这次备份', async () => {
  await page.goto('/jobs')
  const job = page.getByRole('row').filter({ hasText: 'backup create' }).first()
  await expect(job).toContainText('完成')
  await page.goto('/audit')
  await page.getByLabel('命令前缀').fill('backup create')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'backup create' }).first()).toBeVisible()
})

test('封禁并解封一个 IP：安全事件里多了两条', async () => {
  await page.goto('/security')
  await page.getByRole('button', { name: '封禁一个 IP' }).click()
  const form = page.getByRole('dialog', { name: '封禁一个 IP' })
  await form.getByLabel(/IP 地址/).fill('198.51.100.7')
  await form.getByRole('button', { name: '封禁' }).click()
  await verify(recovery[6])
  const row = page.getByTestId('ban-198.51.100.7')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '解封' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await verify(recovery[7])
  await expect(row).toBeHidden()
  await page.getByRole('tab', { name: '安全事件' }).click()
  const events = page.getByRole('row').filter({ hasText: '198.51.100.7' })
  await expect(events.filter({ hasText: '手动封禁' })).toHaveCount(1)
  await expect(events.filter({ hasText: '解封' })).toHaveCount(1)
})

// 服务器页（m2-07、m2-08）：这里没有真的节点，只走不需要节点的路径。安装命令的内容与错误原文由主控决定，不断言。
// 放在最后：设主控地址会改设置。
test('服务器页：以 pull 模式添加服务器，总览里看到它，取安装命令，设限速看到错误，查看、吊销与轮换凭据', async () => {
  await page.getByRole('link', { name: '服务器' }).click()
  await page.getByRole('button', { name: '添加服务器' }).click()
  const form = page.getByRole('dialog', { name: '添加服务器' })
  await form.getByLabel('名字').fill('e2e-node')
  await form.getByRole('combobox', { name: '连接模式' }).click()
  await page.getByRole('option', { name: 'pull' }).click()
  await form.getByLabel('轮询地址（IPv4 或主机名）').fill('203.0.113.9')
  await form.getByRole('button', { name: '添加' }).click()
  await expect(page).toHaveURL(/\/servers\/e2e-node$/)
  await expect(page.getByRole('heading', { name: 'e2e-node' })).toBeVisible()
  await expect(page.getByText('等待首次连接')).toBeVisible()
  // 编辑、连接等标签页切走后仍然挂着（hidden），所以限定在「概况」里找
  const overview = page.getByRole('tabpanel', { name: '概况' })
  await expect(overview.getByText('pull', { exact: true })).toBeVisible()
  await expect(overview.getByText('203.0.113.9', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '服务器列表' }).click()
  await expect(page.getByTestId('server-e2e-node')).toContainText('等待首次连接')

  // 总览首页的服务器分区列出它，点名字进详情页
  await page.getByRole('link', { name: '总览', exact: true }).click()
  const partition = page.getByTestId('partition-servers')
  await expect(partition.getByText('等待首次连接')).toBeVisible()
  await partition.getByRole('link', { name: 'e2e-node', exact: true }).click()
  await expect(page).toHaveURL(/\/servers\/e2e-node$/)

  // 主控地址没设：显示主控的错误
  await page.getByRole('button', { name: '取安装命令' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('install-command')).toHaveCount(0)

  await page.goto('/settings')
  await page.getByLabel('主控地址', { exact: true }).fill('https://panel.e2e.example')
  await page.getByRole('button', { name: '保存主控地址' }).click()
  await verify(await freshCode())
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()

  await page.goto('/servers/e2e-node')
  await page.getByRole('button', { name: '取安装命令' }).click()
  await expect(page.getByTestId('install-command')).not.toBeEmpty()
  await expect(page.getByText('https://panel.e2e.example', { exact: true })).toBeVisible()

  // 连接、限速、踢线三页切走后仍然挂着（hidden），所以限定在可见的「限速」页里找输入框
  await page.getByRole('tab', { name: '限速' }).click()
  const limit = page.getByRole('tabpanel', { name: '限速' })
  await limit.getByLabel('入站').fill('in1')
  await limit.getByLabel('凭据').fill('A')
  await limit.getByLabel('限速（Mbps）').fill('5')
  await limit.getByRole('button', { name: '设置' }).click()
  await expect(limit.getByRole('alert')).toBeVisible()
  await expect(page.getByTestId('limit-result')).toHaveCount(0)

  // 凭据：查看原文；吊销（不要求节点在线）后 token 变了；轮换要求节点在线，这里看到主控的错误
  await page.getByRole('tab', { name: '凭据' }).click()
  const creds = page.getByRole('tabpanel', { name: '凭据' })
  await creds.getByRole('button', { name: '查看原文' }).click()
  const token = creds.getByTestId('token-token')
  await expect(token).not.toBeEmpty()
  const before = (await token.textContent()) ?? ''
  await creds.getByRole('button', { name: '吊销' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(token).not.toHaveText(before)
  await expect(token).not.toBeEmpty()
  await creds.getByRole('button', { name: '轮换' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(creds.getByRole('alert')).toBeVisible()
})

// m2-14：列表页的实时推送（同时验证推送能过 CSP、会话 Cookie 与同源检查）；节点没有连上，系统与日志看到主控的错误；
// 流量统计口径只写库，不要求节点在线。
test('服务器页：列表页是实时推送，系统与日志看到错误，改流量统计口径', async () => {
  await page.goto('/servers')
  await expect(page.getByTestId('feed-mode')).toHaveText('实时推送')
  await expect(page.getByTestId('server-e2e-node')).toBeVisible()

  await page.goto('/servers/e2e-node')
  await page.getByRole('tab', { name: '系统' }).click()
  const system = page.getByRole('tabpanel', { name: '系统' })
  await system.getByRole('button', { name: '读取' }).click()
  await expect(system.getByRole('alert')).toHaveCount(2)
  await expect(system.getByTestId('system-info')).toHaveCount(0)

  await page.getByRole('tab', { name: '日志' }).click()
  const logs = page.getByRole('tabpanel', { name: '日志' })
  await logs.getByRole('button', { name: '查询' }).click()
  await expect(logs.getByRole('alert')).toHaveCount(1)
  await expect(logs.getByTestId('log-lines')).toHaveCount(0)

  await page.getByRole('tab', { name: '流量' }).click()
  const stats = page.getByRole('tabpanel', { name: '流量' }).getByTestId('traffic-stats')
  // 新服务器的数据源默认是物理网卡（system）：改成内核统计，物理网卡的周期累计随之不再显示
  await expect(stats.getByText('本周期物理网卡')).toBeVisible()
  await stats.getByRole('combobox', { name: '数据源' }).click()
  await page.getByRole('option', { name: '内核统计' }).click()
  await stats.getByRole('button', { name: '保存口径' }).click()
  await expect(stats.getByText('本周期物理网卡')).toHaveCount(0)
  await expect(stats.getByRole('definition').filter({ hasText: '内核统计' })).toBeVisible()
})

// m2-16：服务器编辑走 plan / apply。这台服务器从没下发过配置、节点也没连上，所以提交时节点那一步失败（partial_failure），
// 但主控库已经写入；节点配置看到主控的错误；配置变更页有这份计划与快照，按快照生成回滚计划（不提交）；改批量门控阈值。
test('服务器编辑、节点配置、配置变更页与批量门控', async () => {
  await page.goto('/servers/e2e-node')
  await page.getByRole('tab', { name: '编辑' }).click()
  const edit = page.getByRole('tabpanel', { name: '编辑' })
  await edit.getByLabel('地区', { exact: true }).fill('e2e-region')
  await edit.getByRole('button', { name: '预演' }).click()
  await expect(edit.getByTestId('plan-field-region')).toContainText('e2e-region')
  await edit.getByRole('button', { name: '提交' }).click()
  await expect(edit.getByTestId('apply-partial')).toContainText('配置已写入主控库')
  await expect(edit.getByLabel('地区', { exact: true })).toHaveValue('e2e-region')

  await page.getByRole('tab', { name: '节点配置' }).click()
  const config = page.getByRole('tabpanel', { name: '节点配置' })
  await config.getByRole('button', { name: '查看同步状态' }).click()
  await expect(config.getByRole('alert')).toHaveCount(1)
  await expect(config.getByTestId('config-status')).toHaveCount(0)

  await page.goto('/changes')
  await expect(page.locator('[data-testid^="plan-row-"]').first()).toBeVisible()
  await page.getByRole('tab', { name: '快照' }).click()
  const snapshot = page.locator('[data-testid^="snapshot-row-"]').first()
  await expect(snapshot).toContainText('Server')
  await snapshot.getByRole('button', { name: '回滚', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('plan-review')).toBeVisible()
  await expect(dialog.getByRole('button', { name: '提交' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.goto('/settings')
  const single = page.getByTestId('batch-batch_single_threshold')
  await single.getByLabel('单次上限').fill('10')
  await single.getByRole('button', { name: '保存' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(page.getByText('已保存', { exact: true })).toBeVisible()
  await expect(single.getByLabel('单次上限')).toHaveValue('10')
})

// submitPlan 提交一份预演结果：前面的测试用掉了批量窗口时，主控要求危险类「批量」，会先弹危险确认（确认值由预演给出）。
// e2e-node 没有连上，提交都以部分节点失败结束：主控库已写入、节点那一步失败。
async function submitPlan(scope: Locator) {
  await scope.getByRole('button', { name: '提交' }).click()
  const confirm = page.getByRole('alertdialog')
  const partial = scope.getByTestId('apply-partial')
  await expect(confirm.or(partial)).toBeVisible()
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: '确认' }).click()
  await expect(partial).toContainText('配置已写入主控库')
}

test('代理页：入站向导与一次性凭据、出站与探测、落地与批量规划、参考', async () => {
  await page.goto('/proxy')
  await page.getByRole('combobox', { name: '服务器' }).click()
  await page.getByRole('option', { name: 'e2e-node' }).click()

  // 入站向导：服务器默认取页面上选中的那台；主控生成的凭据只显示这一次
  const inbounds = page.getByRole('tabpanel', { name: '入站' })
  await inbounds.getByRole('button', { name: '新建入站' }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('combobox', { name: '服务器' })).toHaveText('e2e-node')
  await dialog.getByRole('combobox', { name: '协议' }).click()
  await page.getByRole('option', { name: /^Shadowsocks/ }).click()
  await dialog.getByLabel('端口').fill('18443')
  await dialog.getByRole('button', { name: '生成' }).click()
  const result = dialog.getByTestId('wizard-result')
  await expect(result.getByText('凭据只显示这一次')).toBeVisible()
  await expect(result.locator('[data-testid^="copy-"]').first()).toBeVisible()
  await result.getByRole('button', { name: '预演' }).click()
  await expect(result.getByTestId('plan-review')).toBeVisible()
  await submitPlan(result)
  // 提交之后向导锁住；凭据还显示着，关闭前要确认
  await expect(dialog.getByTestId('wizard-locked')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(dialog).toBeHidden()
  await expect(inbounds.locator('[data-testid^="inbound-row-"]').filter({ hasText: '18443' })).toBeVisible()

  // 出站：新建一个 direct 出站并提交；探测要问节点，节点没有连上，看到主控返回的错误
  await page.getByRole('tab', { name: '出站' }).click()
  const outbounds = page.getByRole('tabpanel', { name: '出站' })
  await outbounds.getByRole('button', { name: '新建出站' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('tag').fill('e2e-direct')
  await dialog.getByLabel(/^协议/).fill('direct')
  await dialog.getByRole('button', { name: '预演' }).click()
  await expect(dialog.getByTestId('plan-review')).toBeVisible()
  await submitPlan(dialog)
  await page.keyboard.press('Escape')
  const row = outbounds.locator('[data-testid^="outbound-row-"]').filter({ hasText: 'e2e-direct' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '探测' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '探测' }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByTestId('probe-result')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // 落地规划（手工协议）：预演结果里有一个新出站与一条路由规则；不提交
  await outbounds.getByRole('button', { name: '落地规划' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('新出站的 tag').fill('e2e-landing')
  await dialog.getByRole('combobox', { name: '落地目标的来源' }).click()
  await page.getByRole('option', { name: '手工填协议与 settings' }).click()
  await dialog.getByLabel('协议').fill('socks')
  await dialog.getByLabel('settings').fill('{"server":"203.0.113.10","server_port":1080}')
  await dialog.getByRole('button', { name: '预演' }).click()
  const landing = dialog.getByTestId('plan-review')
  await expect(landing).toContainText('Outbound')
  await expect(landing).toContainText('RoutingRule')
  await page.keyboard.press('Escape')

  // 批量新建入站（全部服务器，端口留空由主控各自分配）：预演结果列出 e2e-node；不提交
  await page.getByRole('tab', { name: '入站' }).click()
  await inbounds.getByRole('button', { name: '批量新建' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('switch', { name: '全部服务器' }).click()
  await dialog.getByRole('combobox', { name: '协议' }).click()
  await page.getByRole('option', { name: /^Shadowsocks/ }).click()
  await dialog.getByRole('button', { name: '预演' }).click()
  await expect(dialog.getByTestId('plan-review')).toContainText('e2e-node')
  await page.keyboard.press('Escape')

  // 参考：协议矩阵里有 vless；生成一个 UUID
  await page.getByRole('tab', { name: '参考' }).click()
  const reference = page.getByRole('tabpanel', { name: '参考' })
  await expect(reference.getByTestId('protocol-vless')).toBeVisible()
  await reference.getByRole('combobox', { name: '类型' }).click()
  await page.getByRole('option', { name: 'UUID', exact: true }).click()
  await reference.getByRole('button', { name: '生成' }).click()
  await expect(reference.getByTestId('copy-uuid')).toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)
})

// 主控地址迁移会改主控地址并清空 Turnstile 的 key：这一条必须是整套测试的最后一步，以后加的测试放在它前面。
test('维护页：探测主控地址与卸载看到错误；系统设置页预检并迁移主控地址', async () => {
  // 节点没有连上：探测与卸载都由主控回错误
  await page.goto('/servers/e2e-node')
  await page.getByRole('tab', { name: '维护' }).click()
  const maint = page.getByRole('tabpanel', { name: '维护' })
  await maint.getByRole('button', { name: '探测' }).click()
  await expect(maint.getByRole('alert')).toHaveCount(1)
  await expect(maint.getByTestId('probe-result')).toHaveCount(0)
  await maint.getByRole('button', { name: '卸载' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认' }).click()
  await expect(maint.getByRole('alert')).toHaveCount(2)
  await expect(maint.getByTestId('uninstall-result')).toHaveCount(0)

  // 预检：等待首次连接的 e2e-node 算离线，会被跳过，不挡迁移；再正式迁移。8 枚恢复码前面已经用完，这里用验证器的码
  await page.goto('/settings')
  await page.getByLabel('新的主控地址（https://）').fill('https://panel2.e2e.example')
  await page.getByRole('button', { name: '预检', exact: true }).click()
  await verify(await freshCode())
  const result = page.getByTestId('migrate-result')
  await expect(result).toContainText('预检通过，可以迁移。')
  await expect(result).toContainText('跳过的离线节点：e2e-node')
  await expect(page.getByTestId('migrate-node-e2e-node')).toContainText('离线')
  await page.getByRole('button', { name: '迁移', exact: true }).click()
  await verify(await freshCode())
  await expect(result).toContainText('已迁移到 https://panel2.e2e.example')
  await expect(page.getByLabel('主控地址', { exact: true })).toHaveValue('https://panel2.e2e.example')
})
