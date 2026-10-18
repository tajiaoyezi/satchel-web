import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

// cn 合并 class 名，后面的 Tailwind class 覆盖前面冲突的（shadcn/ui 的约定）。
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
