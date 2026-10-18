// RestartTimeout：等满 upWaitMs 主控还是连不上。
export class RestartTimeout extends Error {}

// waitForRestart 等主控重启完（初始化向导恢复备份之后用，web-console「初始化向导」）：先等它停下（check 失败一次，最多等
// downWaitMs，等不到也往下走：可能重启得太快没看到），再等 check 连续成功 needed 次，最多等 upWaitMs，等不到抛 RestartTimeout。
// sleep 与 now 可以换，测试里不用真等。
export async function waitForRestart(
  check: () => Promise<unknown>,
  {
    intervalMs = 2000,
    downWaitMs = 30000,
    upWaitMs = 300000,
    needed = 2,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  } = {},
): Promise<void> {
  const ok = () =>
    check().then(
      () => true,
      () => false,
    )
  const start = now()
  while (now() - start < downWaitMs) {
    await sleep(intervalMs)
    if (!(await ok())) break
  }
  const upStart = now()
  let streak = 0
  while (streak < needed) {
    if (now() - upStart >= upWaitMs) throw new RestartTimeout('master did not come back')
    await sleep(intervalMs)
    streak = (await ok()) ? streak + 1 : 0
  }
}
