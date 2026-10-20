import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ChevronDown, LogOut, Moon, Palette, Sun, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { accountQuery } from '@/api/queries'
import { logout } from '@/api/session'
import { readBoot } from '@/boot'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/theme/ThemeProvider'
import { IMPLEMENTED, THEMES, isThemeName, type Mode } from '@/theme/themes'

// OPS_PAGES 是「运维」菜单里的八页，按这个顺序列；名字取各页资源文件里的标题。
const OPS_PAGES = [
  { to: '/logs', ns: 'logs' },
  { to: '/schedule', ns: 'schedule' },
  { to: '/jobs', ns: 'jobs' },
  { to: '/audit', ns: 'audit' },
  { to: '/security', ns: 'security' },
  { to: '/backups', ns: 'backups' },
  { to: '/database', ns: 'database' },
  { to: '/update', ns: 'update' },
] as const

// 顶部导航与用户菜单（web-console「布局与导航」）：系统设置与运维菜单只对管理员显示，权限仍由主控判定。
export function TopNav() {
  const { t } = useTranslation()
  const account = useQuery(accountQuery).data
  const isAdmin = account?.role === 'admin'
  const boot = readBoot()
  const links = [
    { to: '/', label: t('nav.overview') },
    { to: '/tokens', label: t('nav.tokens') },
    ...(isAdmin ? [{ to: '/settings', label: t('nav.settings') }] : []),
  ] as const
  return (
    <header className="bg-card border-b">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 py-2" aria-label={t('appName')}>
        <Link to="/" className="mr-4 flex items-center gap-2 font-semibold">
          {boot.logo_url && <img src={boot.logo_url} alt="" className="size-6 rounded object-contain" />}
          <span>{boot.brand_title || t('appName')}</span>
        </Link>
        {links.map((l) => (
          <Button key={l.to} asChild variant="ghost" size="sm">
            <Link to={l.to} activeOptions={{ exact: l.to === '/' }} activeProps={{ className: 'bg-accent' }}>
              {l.label}
            </Link>
          </Button>
        ))}
        {isAdmin && <OpsMenu />}
        <div className="ml-auto">
          <UserMenu username={account?.username ?? ''} />
        </div>
      </nav>
    </header>
  )
}

function OpsMenu() {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (l) => l.pathname })
  const active = OPS_PAGES.some((p) => pathname === p.to)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={active ? 'bg-accent' : undefined}>
          {t('nav.ops')}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {OPS_PAGES.map((p) => (
          <DropdownMenuItem key={p.to} asChild>
            <Link to={p.to}>{t('title', { ns: p.ns })}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function UserMenu({ username }: { username: string }) {
  const { t } = useTranslation()
  const { theme, mode, setTheme, setMode } = useTheme()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const onLogout = async () => {
    try {
      await logout()
    } finally {
      queryClient.clear()
      await navigate({ to: '/login' })
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('userMenu.account')}>
          <User />
          {username}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/account">
            <User />
            {t('userMenu.account')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          <Palette className="size-4" />
          {t('userMenu.theme')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => isThemeName(v) && setTheme(v)}>
          {THEMES.map((name) => (
            <DropdownMenuRadioItem key={name} value={name} title={IMPLEMENTED[name] ? undefined : t('userMenu.notYet')}>
              {t(`themes.${name}`)}
              {!IMPLEMENTED[name] && <span className="text-muted-foreground ml-auto text-xs">*</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex items-center gap-2">
          {mode === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          {t('userMenu.mode')}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <DropdownMenuRadioItem value="light">{t('userMenu.light')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t('userMenu.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t('userMenu.system')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void onLogout()}>
          <LogOut />
          {t('actions.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
