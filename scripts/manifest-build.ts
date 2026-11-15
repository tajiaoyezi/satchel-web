import fs from 'node:fs'
import path from 'node:path'

import * as ts from 'typescript'

import type { CommandRoute } from '../src/api/commands'
import { sessionEntries } from '../src/api/session-entries'
import type { PageDef } from '../src/manifest'

// buildManifest 把页面清单与命令表合成 dist/satchel-web.json 的内容（Vite 插件在构建时调它）。文案 key 用 text 换成中文；
// 问题清单非空时插件让构建失败：对照表里的命令不在命令表里、命令表里的命令没有出现在任何一页、会话入口不认识、文案 key 不存在；
// 传入 routesDir 时还会用 TypeScript AST 静态扫描路由目录，拦下直接 fetch() 与未登记的 API client 命令调用。
// 不依赖浏览器 API：它在 Node 里跑。
export interface BuildInput {
  version: string
  pages: PageDef[]
  commands: Record<string, CommandRoute>
  text: (key: string) => string | undefined
  routesDir?: string
}

const CLIENT_FUNCTIONS = new Set(['run', 'upload', 'download'])
const FETCH_GLOBALS = new Set(['window', 'globalThis', 'self'])

function walkRouteFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkRouteFiles(full))
      continue
    }
    if (!entry.isFile()) continue
    if (!/\.(tsx?)$/.test(entry.name)) continue
    if (/\.test\.(tsx?)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
    files.push(full)
  }
  return files.sort()
}

function routeFileToPath(rel: string): string | null {
  const noExt = rel.replace(/\.(tsx?)$/, '')
  const segments = noExt.split('/')
  const last = segments[segments.length - 1]
  if (!last || last.startsWith('_')) return null
  const kept = segments.filter((seg) => !seg.startsWith('_'))
  if (kept[kept.length - 1] === 'index') kept.pop()
  return kept.length === 0 ? '/' : `/${kept.join('/')}`
}

function isApiClientSpecifier(spec: string): boolean {
  return spec === '@/api/client' || /(?:^|\/)api\/client(?:\.ts)?$/.test(spec)
}

function scanRoutesDir(routesDir: string, pages: PageDef[], commands: Record<string, CommandRoute>): string[] {
  const problems: string[] = []
  if (!fs.existsSync(routesDir)) {
    problems.push(`路由目录不存在：${routesDir}`)
    return problems
  }
  const pageByPath = new Map<string, { id: string; commands: Set<string> }>()
  for (const page of pages) {
    pageByPath.set(page.path, {
      id: page.id,
      commands: new Set(page.actions.flatMap((a) => (a.command ? [a.command] : []))),
    })
  }

  for (const file of walkRouteFiles(routesDir)) {
    const rel = path.relative(routesDir, file).split(path.sep).join('/')
    const sourceText = fs.readFileSync(file, 'utf8')
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind)

    const clientFns = new Set<string>()
    const clientNamespaces = new Set<string>()
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
      if (!ts.isStringLiteral(stmt.moduleSpecifier) || !isApiClientSpecifier(stmt.moduleSpecifier.text)) continue
      const bindings = stmt.importClause.namedBindings
      if (!bindings) continue
      if (ts.isNamespaceImport(bindings)) {
        clientNamespaces.add(bindings.name.text)
        continue
      }
      if (ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text
          if (CLIENT_FUNCTIONS.has(imported)) clientFns.add(el.name.text)
        }
      }
    }

    const routePath = routeFileToPath(rel)
    const page = routePath !== null ? pageByPath.get(routePath) : undefined

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        const expr = node.expression
        const isDirectFetch = ts.isIdentifier(expr) && expr.text === 'fetch'
        const isGlobalFetch =
          ts.isPropertyAccessExpression(expr) &&
          expr.name.text === 'fetch' &&
          ts.isIdentifier(expr.expression) &&
          FETCH_GLOBALS.has(expr.expression.text)
        if (isDirectFetch || isGlobalFetch) {
          problems.push(`路由文件 ${rel}:${line} 直接调用 fetch()，请改用 @/api/client 或 @/api/session`)
        }

        const isNamedClientCall = ts.isIdentifier(expr) && clientFns.has(expr.text)
        const isNsClientCall =
          ts.isPropertyAccessExpression(expr) &&
          ts.isIdentifier(expr.expression) &&
          clientNamespaces.has(expr.expression.text) &&
          CLIENT_FUNCTIONS.has(expr.name.text)
        if (isNamedClientCall || isNsClientCall) {
          const firstArg = node.arguments[0]
          if (firstArg && (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
            const cmd = firstArg.text
            if (!(cmd in commands)) {
              problems.push(`路由文件 ${rel}:${line} 调用的命令 ${cmd} 不在 src/api/commands.ts 里`)
            } else if (page && !page.commands.has(cmd)) {
              problems.push(`路由文件 ${rel}:${line} 调用了命令 ${cmd}，但未列入页面 ${page.id} 的操作清单 src/manifest.ts 里`)
            }
          } else {
            problems.push(`路由文件 ${rel}:${line} 调用 API client 时未使用静态命令字符串`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return problems
}

export function buildManifest({ version, pages, commands, text, routesDir }: BuildInput) {
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
  if (routesDir !== undefined) {
    problems.push(...scanRoutesDir(routesDir, pages, commands))
  }
  const outCommands = Object.fromEntries(Object.entries(commands).map(([name, r]) => [name, { method: r.method, path: r.path }]))
  return { manifest: { version, pages: outPages, commands: outCommands }, problems }
}
