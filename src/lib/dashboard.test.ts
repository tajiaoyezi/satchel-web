import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dashboardFrame, dashboardServer, FakeWebSocket, installFakeWebSocket } from '@/test/websocket'

import { dashboardURL, useDashboardFeed } from './dashboard'

beforeEach(() => {
  installFakeWebSocket()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// m2-14 design 第 1 条。
describe('useDashboardFeed', () => {
  it('地址按页面协议拼：https 用 wss，否则 ws', () => {
    expect(dashboardURL({ protocol: 'https:', host: 'panel.example.com' })).toBe('wss://panel.example.com/api/v1/ws/dashboard')
    expect(dashboardURL({ protocol: 'http:', host: '127.0.0.1:12889' })).toBe('ws://127.0.0.1:12889/api/v1/ws/dashboard')
  })

  it('收到 realtime 帧后 live；不是 realtime 的帧与解不开的文本被忽略', () => {
    const { result } = renderHook(() => useDashboardFeed())
    const ws = FakeWebSocket.latest()
    expect(ws.url).toBe(`ws://${window.location.host}/api/v1/ws/dashboard`)
    expect(result.current.live).toBe(false)
    act(() => ws.push({ type: 'other', servers: [], summary: {} }))
    act(() => ws.push('not json'))
    expect(result.current.live).toBe(false)
    act(() => ws.push(dashboardFrame([dashboardServer('hk-1', { current_upload_speed: 2048 })])))
    expect(result.current.live).toBe(true)
    expect(result.current.frame?.servers[0]?.current_upload_speed).toBe(2048)
  })

  it('断开后按 1、2、4 秒重连；收到帧后间隔重置', () => {
    const { result } = renderHook(() => useDashboardFeed())
    act(() => FakeWebSocket.latest().push(dashboardFrame([])))
    act(() => FakeWebSocket.latest().serverClose())
    expect(result.current.live).toBe(false)
    expect(FakeWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(999))
    expect(FakeWebSocket.instances).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => FakeWebSocket.latest().serverClose())
    act(() => vi.advanceTimersByTime(1999))
    expect(FakeWebSocket.instances).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(3)
    act(() => FakeWebSocket.latest().push(dashboardFrame([])))
    act(() => FakeWebSocket.latest().serverClose())
    act(() => vi.advanceTimersByTime(1000))
    expect(FakeWebSocket.instances).toHaveLength(4)
  })

  it('重连间隔最多 30 秒', () => {
    renderHook(() => useDashboardFeed())
    for (let i = 0; i < 8; i++) {
      act(() => FakeWebSocket.latest().serverClose())
      act(() => vi.advanceTimersByTime(30_000))
    }
    const n = FakeWebSocket.instances.length
    act(() => FakeWebSocket.latest().serverClose())
    act(() => vi.advanceTimersByTime(29_999))
    expect(FakeWebSocket.instances).toHaveLength(n)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeWebSocket.instances).toHaveLength(n + 1)
  })

  it('超过 max(3 × 刷新间隔, 15 秒) 没收到帧：丢掉这条连接、不再 live，并重连', () => {
    const { result } = renderHook(() => useDashboardFeed())
    const first = FakeWebSocket.latest()
    act(() => first.push(dashboardFrame([], 10_000)))
    act(() => vi.advanceTimersByTime(29_999))
    expect(result.current.live).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(first.closed).toBe(true)
    expect(result.current.live).toBe(false)
    act(() => vi.advanceTimersByTime(1000))
    expect(FakeWebSocket.instances).toHaveLength(2)
  })

  it('卸载时关闭连接，之后不再重连', () => {
    const { unmount } = renderHook(() => useDashboardFeed())
    const ws = FakeWebSocket.latest()
    unmount()
    expect(ws.closed).toBe(true)
    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})
