import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest 没开全局模式，Testing Library 不会自己在每个测试之后清掉渲染的页面。
afterEach(() => cleanup())

// jsdom 没实现 scrollTo；路由在切换页面时会调它。
window.scrollTo = () => {}

// jsdom 没有 ResizeObserver；Radix 的部分组件（复选框、开关）要用它量尺寸。
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver
