// 会话入口的名字（master-web「页面清单与命令表一致」：它们不是命令，清单里按这四个名字登记）。
// 单独成文件、不依赖浏览器 API：Vite 配置合成页面清单时也引用它。
export const sessionEntries = ['login', 'two-factor', 'logout', 'captcha'] as const
export type SessionEntry = (typeof sessionEntries)[number]
