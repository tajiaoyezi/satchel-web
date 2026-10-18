/// <reference types="vitest/config" />
import fs from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, type Plugin } from 'vite'

import { commands } from './src/api/commands'
import { pages } from './src/manifest'
import { buildManifest } from './scripts/manifest-build'

// 产物在 dist/，由主控 satchel 的构建脚本按 tag 拉取后编进二进制（技术方案第 08 章，master-web）。

// devPlaceholders 只在 npm run dev 时把 index.html 里给主控首屏注入留的占位换成默认值：开发服务器没有主控来注入。
function devPlaceholders(): Plugin {
  return {
    name: 'satchel-dev-placeholders',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace('__SATCHEL_SITE_TITLE__', 'Satchel').replace('__SATCHEL_BOOT__', '{}')
    },
  }
}

// localeText 按「命名空间:路径」取中文资源里的文案。
function localeText(key: string): string | undefined {
  const [ns, path] = key.split(':')
  const file = fileURLToPath(new URL(`./src/i18n/locales/zh/${ns}.json`, import.meta.url))
  if (!fs.existsSync(file)) return undefined
  let v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const part of path.split('.')) v = (v as Record<string, unknown> | undefined)?.[part]
  return typeof v === 'string' ? v : undefined
}

// satchelManifest 在构建时把页面清单与命令表合成 dist/satchel-web.json（master-web）；有问题就让构建失败。
// 版本取环境变量 SATCHEL_WEB_VERSION（主控的构建脚本给 tag），没有时是 dev。
function satchelManifest(): Plugin {
  return {
    name: 'satchel-manifest',
    apply: 'build',
    generateBundle() {
      const { manifest, problems } = buildManifest({ version: process.env.SATCHEL_WEB_VERSION || 'dev', pages, commands, text: localeText })
      if (problems.length > 0) this.error('页面清单有问题：\n' + problems.join('\n'))
      this.emitFile({ type: 'asset', fileName: 'satchel-web.json', source: JSON.stringify(manifest, null, 2) + '\n' })
    },
  }
}

// 本地联调：把 /api 与 /public 代理到一台 Linux 上跑的主控（serve 只在 Linux 上跑）。不设 changeOrigin、Host 保持浏览器的：
// 主控的同源检查要求写请求的 Origin 与 Host 一致，改成目标主机后登录、保存这些写请求都会被拒。
const devTarget = process.env.SATCHEL_DEV_TARGET

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss(), devPlaceholders(), satchelManifest()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: devTarget
    ? {
        proxy: {
          '/api': { target: devTarget },
          '/public': { target: devTarget },
        },
      }
    : undefined,
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
  },
})
