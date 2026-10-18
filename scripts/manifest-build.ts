import type { CommandRoute } from '../src/api/commands'
import { sessionEntries } from '../src/api/session-entries'
import type { PageDef } from '../src/manifest'

// buildManifest 把页面清单与命令表合成 dist/satchel-web.json 的内容（Vite 插件在构建时调它）。文案 key 用 text 换成中文；
// 问题清单非空时插件让构建失败：对照表里的命令不在命令表里、命令表里的命令没有出现在任何一页、会话入口不认识、文案 key 不存在。
// 不依赖浏览器 API：它在 Node 里跑。
export interface BuildInput {
  version: string
  pages: PageDef[]
  commands: Record<string, CommandRoute>
  text: (key: string) => string | undefined
}

export function buildManifest({ version, pages, commands, text }: BuildInput) {
  const problems: string[] = []
  const used = new Set<string>()
  const resolve = (key: string) => {
    const v = text(key)
    if (v === undefined) problems.push(`文案 key ${key} 在资源文件里不存在`)
    return v ?? key
  }
  const outPages = pages.map((p) => ({
    id: p.id,
    path: p.path,
    title: resolve(p.titleKey),
    actions: p.actions.map((a) => {
      if (a.command) {
        if (!(a.command in commands)) problems.push(`页面 ${p.id} 的操作 ${a.labelKey} 写的命令 ${a.command} 不在 src/api/commands.ts 里`)
        used.add(a.command)
      }
      if (a.session && !(sessionEntries as readonly string[]).includes(a.session)) problems.push(`页面 ${p.id} 写了不认识的会话入口 ${a.session}`)
      return { label: resolve(a.labelKey), ...(a.command ? { command: a.command } : {}), ...(a.session ? { session: a.session } : {}) }
    }),
  }))
  for (const name of Object.keys(commands)) {
    if (!used.has(name)) problems.push(`命令 ${name} 在 src/api/commands.ts 里，但没有出现在任何一页的对照表里`)
  }
  const outCommands = Object.fromEntries(Object.entries(commands).map(([name, r]) => [name, { method: r.method, path: r.path }]))
  return { manifest: { version, pages: outPages, commands: outCommands }, problems }
}
