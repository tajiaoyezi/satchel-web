import type { ReactNode } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

// WideDialog 是可以滚动、宽一些的对话框：计划详情、预演结果与代理资源的表单都在它里面打开（配置变更页与代理页共用）。
// guard 给了时，点外面、按 Esc 或点关闭都先问它，回真才关（比如只显示一次的凭据，误点一下就没了）。
export function WideDialog(props: { title: string; description?: string; onClose: () => void; guard?: () => Promise<boolean>; children: ReactNode }) {
  const { title, description, onClose, guard, children } = props
  const close = () => {
    if (!guard) return onClose()
    void guard().then((ok) => ok && onClose())
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
