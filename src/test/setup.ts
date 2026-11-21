import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

import { FakeWebSocket } from './websocket'

// Vitest 没开全局模式，Testing Library 不会自己在每个测试之后清掉渲染的页面。
afterEach(() => cleanup())

// jsdom 的 WebSocket 会真的去连网络：一律换成假的（页面打开仪表盘推送时用），由测试控制推帧与关闭。
globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
beforeEach(() => {
  FakeWebSocket.instances = []
})

// jsdom 没实现 scrollTo；路由在切换页面时会调它。
window.scrollTo = () => {}

// jsdom 没有 ResizeObserver；Radix 的部分组件（复选框、开关）要用它量尺寸。
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

// jsdom 没有指针捕获与 scrollIntoView；Radix 的下拉选择框（Select）打开与选中时要用。
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
