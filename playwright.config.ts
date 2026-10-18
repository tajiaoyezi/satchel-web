import { defineConfig, devices } from '@playwright/test'

// 端到端测试（web-console「网页的测试」）：对一个空库的真主控按顺序跑本站页面的主流程。主控地址取 SATCHEL_E2E_URL。
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.SATCHEL_E2E_URL ?? 'http://127.0.0.1:12889',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
