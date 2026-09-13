import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// 产物在 dist/，由主控 satchel 的 CI 按 tag 拉取后 embed（技术方案第 08 章）。
export default defineConfig({
  plugins: [react()],
})
