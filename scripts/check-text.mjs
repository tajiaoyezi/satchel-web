// 文案检查（web-console「文案与 i18n」）：界面文案必须放在 src/i18n/locales/ 的资源文件里，源码里不许出现中文字面量。
// 用 TypeScript 的语法树扫 .ts、.tsx 里的字符串字面量、模板字符串与 JSX 文本；注释不查（项目的注释约定是中文）。
// 不查的：资源文件本身、测试文件与 src/test/ 下的测试辅助、路由插件生成的 routeTree.gen.ts、shadcn/ui 生成的 src/components/ui/。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const han = /\p{Script=Han}/u

function skipped(file) {
  const p = file.split(path.sep).join('/')
  return p.includes('/i18n/locales/') || p.includes('/components/ui/') || p.includes('/src/test/') || /\.test\.tsx?$/.test(p) || p.endsWith('routeTree.gen.ts')
}

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) return files(full)
    return /\.tsx?$/.test(e.name) && !skipped(full) ? [full] : []
  })
}

// checkText 返回 dir 下每一处写死的中文：文件、行号与原文。
export function checkText(dir) {
  const problems = []
  for (const file of files(dir)) {
    const text = fs.readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node) => {
      const literal =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)
      if (literal && han.test(node.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const last = problems[problems.length - 1]
        if (!last || last.file !== file || last.line !== line) problems.push({ file, line, text: node.text.trim() }) // 一行只报一次
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? 'src')
  const problems = checkText(root)
  for (const p of problems) console.error(`${path.relative(process.cwd(), p.file)}:${p.line}: 写死了界面文案「${p.text}」，放进 src/i18n/locales/ 的资源文件`)
  if (problems.length > 0) process.exit(1)
  console.log('文案检查通过')
}
