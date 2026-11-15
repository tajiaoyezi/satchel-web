import { useSyncExternalStore } from 'react'

// 主控首屏注入的启动配置（master-web「首屏注入」）：index.html 里 id 为 satchel-boot 的 JSON 数据块。
export interface BootConfig {
  site_title: string
  brand_title: string
  logo_url: string
  login_wallpaper: string
  default_theme: string
}

const empty: BootConfig = { site_title: '', brand_title: '', logo_url: '', login_wallpaper: '', default_theme: '' }
const listeners = new Set<() => void>()

let cachedDoc: Document | null = null
let cachedRaw: string | null = null
let cachedBoot: BootConfig = empty

// readBoot 读启动配置；开发服务器或解析失败时给空值（品牌用默认样式）。
// 对相同文档内容返回稳定对象引用，供 useSyncExternalStore 使用。
export function readBoot(doc: Document = document): BootConfig {
  const raw = doc.getElementById('satchel-boot')?.textContent ?? '{}'
  if (doc === cachedDoc && raw === cachedRaw) return cachedBoot
  cachedDoc = doc
  cachedRaw = raw
  try {
    cachedBoot = { ...empty, ...(JSON.parse(raw) as Partial<BootConfig>) }
  } catch {
    cachedBoot = empty
  }
  return cachedBoot
}

// subscribeBoot 订阅启动配置变更，配合 readBoot 用于实时同步品牌与默认主题。
export function subscribeBoot(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBoot(): BootConfig {
  return useSyncExternalStore(subscribeBoot, () => readBoot(), () => empty)
}

// updateBoot 在品牌设置写成功后换掉页面里的启动配置与 <title>（web-console「改品牌后登录页变了」）：网页是单页应用，
// 退出登录走前端跳转、不重新请求 index.html，不换的话登录页与导航还显示旧的品牌。
export function updateBoot(boot: BootConfig, doc: Document = document) {
  const el = doc.getElementById('satchel-boot')
  if (el) el.textContent = JSON.stringify(boot)
  doc.title = boot.site_title || 'Satchel'
  for (const listener of listeners) listener()
}
