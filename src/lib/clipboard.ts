// copyText 把文本写进剪贴板：优先用 Clipboard API；纯 HTTP 等非安全上下文环境里降级为离屏 textarea 拷贝。
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 权限被拒或上下文受限时继续尝试降级方案
    }
  }
  if (typeof document === 'undefined' || !document.body) return false
  const el = document.createElement('textarea')
  el.value = text
  el.readOnly = true
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  el.style.opacity = '0'
  el.style.pointerEvents = 'none'
  document.body.appendChild(el)
  try {
    el.focus()
    el.select()
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    el.remove()
  }
}
