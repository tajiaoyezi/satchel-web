// 主控首屏注入的启动配置（master-web「首屏注入」）：index.html 里 id 为 satchel-boot 的 JSON 数据块。
export interface BootConfig {
  site_title: string
  brand_title: string
  logo_url: string
  login_wallpaper: string
  default_theme: string
}

const empty: BootConfig = { site_title: '', brand_title: '', logo_url: '', login_wallpaper: '', default_theme: '' }

// readBoot 读启动配置；开发服务器或解析失败时给空值（品牌用默认样式）。
export function readBoot(doc: Document = document): BootConfig {
  try {
    const raw = doc.getElementById('satchel-boot')?.textContent ?? '{}'
    return { ...empty, ...(JSON.parse(raw) as Partial<BootConfig>) }
  } catch {
    return empty
  }
}

// updateBoot 在品牌设置写成功后换掉页面里的启动配置与 <title>（web-console「改品牌后登录页变了」）：网页是单页应用，
// 退出登录走前端跳转、不重新请求 index.html，不换的话登录页与导航还显示旧的品牌。
export function updateBoot(boot: BootConfig, doc: Document = document) {
  const el = doc.getElementById('satchel-boot')
  if (el) el.textContent = JSON.stringify(boot)
  doc.title = boot.site_title || 'Satchel'
}
