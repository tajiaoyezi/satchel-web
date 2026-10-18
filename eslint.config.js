import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// src/components/ui/ 是 shadcn/ui 生成的组件，routeTree.gen.ts 由路由插件生成，都不在这里查。
export default defineConfig([
  globalIgnores(['dist', 'src/components/ui', 'src/routeTree.gen.ts', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
  },
  // 路由文件导出 Route、组件留在文件里，由路由插件做代码分割与热更新，这条规则不适用。
  {
    files: ['src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.node } },
  },
])
