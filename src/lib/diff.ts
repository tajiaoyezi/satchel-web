// 按行比较两段文本（m2-16 design 第 3 条）：用最长公共子序列标出相同、新增与删除的行，配置的预演结果里看 kernel.json 前后对比用。

export interface DiffLine {
  type: 'same' | 'add' | 'del'
  text: string
}

// MAX_CELLS 是逐行对齐时比较表的上限（两边行数之积）；超过时不对齐，返回 null，由页面把前后两段原样并排显示。
export const MAX_CELLS = 4_000_000

export function lineDiff(before: string, after: string): DiffLine[] | null {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const n = a.length
  const m = b.length
  if (n * m > MAX_CELLS) return null
  // lcs[i][j] 是 a[i:] 与 b[j:] 的最长公共子序列长度；行数之积有上限，较短的一边不超过 2000 行，Uint16 够用
  const w = m + 1
  const lcs = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) {
      out.push({ type: 'del', text: a[i++]! })
    } else {
      out.push({ type: 'add', text: b[j++]! })
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! })
  while (j < m) out.push({ type: 'add', text: b[j++]! })
  return out
}
