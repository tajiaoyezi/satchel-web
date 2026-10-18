import { request } from './client'
import type { SessionEntry } from './session-entries'

// 会话入口（master-web-session、master-login-protection）：它们不是命令，页面清单里按会话入口登记。

export interface LoginResult {
  username?: string
  role?: string
  expires_at?: string
  recovery_codes_remaining?: number
  recovery_codes_low?: boolean
  two_factor_required?: boolean
  pending?: string
}

export interface CaptchaConfig {
  enabled: boolean
  site_key: string
}

export const sessionPaths: Record<SessionEntry, string> = {
  login: '/api/v1/session',
  'two-factor': '/api/v1/session/two-factor',
  logout: '/api/v1/session',
  captcha: '/api/v1/session/captcha',
}

export function login(username: string, password: string, rememberMe: boolean, turnstileToken?: string) {
  const body: Record<string, unknown> = { username, password, remember_me: rememberMe }
  if (turnstileToken) body.turnstile_token = turnstileToken
  return request<LoginResult>('POST', sessionPaths.login, body)
}

export function completeTwoFactor(pending: string, code: string) {
  return request<LoginResult>('POST', sessionPaths['two-factor'], { pending, code })
}

export function logout() {
  return request<{ logged_out: boolean }>('DELETE', sessionPaths.logout)
}

export function captchaConfig() {
  return request<CaptchaConfig>('GET', sessionPaths.captcha)
}

// healthz 是无身份的健康检查：恢复备份之后等主控重启时轮询它。
export function healthz() {
  return request<{ status: string }>('GET', '/api/v1/healthz')
}
