import { describe, expect, it } from 'vitest'

import { RestartTimeout, waitForRestart } from './restart'

// 假时钟：sleep 只推进时间，不真等。
function clock() {
  let t = 0
  return { sleep: async (ms: number) => void (t += ms), now: () => t }
}

describe('waitForRestart', () => {
  it('先看到停下，再等连续两次成功', async () => {
    const seq = [true, false, false, true, false, true, true, true]
    let i = 0
    const check = () => (seq[i++] ? Promise.resolve() : Promise.reject(new Error('down')))
    await waitForRestart(check, clock())
    expect(i).toBe(7) // 第 2 次看到停下，之后 true、false 断开，最后连续两次 true
  })

  it('一直没看到停下时等满时间再往下走', async () => {
    let n = 0
    const c = clock()
    await waitForRestart(() => (n++, Promise.resolve()), { ...c, intervalMs: 2000, downWaitMs: 10000 })
    expect(c.now()).toBe(14000) // 等停下 5 次 × 2 秒，再连续成功 2 次
    expect(n).toBe(7)
  })

  it('请求一直不回：每次超时算失败，照样等满上限就报错', async () => {
    const c = clock()
    let n = 0
    const hang = (signal: AbortSignal) => (n++, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error))))
    await expect(waitForRestart(hang, { ...c, intervalMs: 2000, downWaitMs: 10000, upWaitMs: 10000, timeoutMs: 20 })).rejects.toBeInstanceOf(RestartTimeout)
    expect(c.now()).toBe(12000) // 第一次挂住就当作停下（2 秒），之后等满 10 秒
    expect(n).toBe(6)
  })

  it('停下之后一直连不上，等满上限就报错', async () => {
    const c = clock()
    const never = () => Promise.reject(new Error('down'))
    await expect(waitForRestart(never, { ...c, intervalMs: 2000, downWaitMs: 10000, upWaitMs: 60000 })).rejects.toBeInstanceOf(RestartTimeout)
    expect(c.now()).toBe(62000) // 第一次就看到停下（2 秒），之后等满 60 秒
  })
})
