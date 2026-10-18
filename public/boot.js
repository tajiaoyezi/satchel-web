// 首屏定主题（web-console「主题框架」）：在页面第一次绘制之前给 <html> 设好 data-theme 与 dark，不闪烁。
// 主题先看浏览器里存的选择，没有就用主控注入的默认主题；没实现的落到扁平。亮暗按存的选择，没选过跟随系统。
// 这是同源的普通脚本，不是内联脚本：主控的 CSP 不放行内联脚本（master-web）。已实现的主题与 src/theme/themes.ts 一致。
;(function () {
  var implemented = { flat: true }
  var boot
  try {
    var el = document.getElementById('satchel-boot')
    boot = JSON.parse((el && el.textContent) || '{}')
  } catch {
    boot = {} // 开发服务器之外不会出现：主控总是注入合法的 JSON
  }
  var theme = null
  var mode = null
  try {
    theme = window.localStorage.getItem('satchel-theme')
    mode = window.localStorage.getItem('satchel-mode')
  } catch {
    // 浏览器禁用了本地存储：按默认值
  }
  theme = theme || boot.default_theme || 'flat'
  if (!implemented[theme]) theme = 'flat'
  var dark = mode === 'dark' || (mode !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (dark) root.classList.add('dark')
  else root.classList.remove('dark')
})()
