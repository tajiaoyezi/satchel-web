// 页面上时间与字节数的显示（design 第 9 条）：时间按浏览器的本地时区，字节数换成 KB、MB 这类单位。

// formatTime 把 RFC 3339 的时间显示成本地时间；空值给空串，认不出的原样给。
export function formatTime(v: string | null | undefined): string {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

const UNITS = ['KB', 'MB', 'GB', 'TB']

// formatBytes 把字节数显示成 B、KB、MB、GB、TB（按 1024 进位，小于 10 时留一位小数）。
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${UNITS[i]}`
}
