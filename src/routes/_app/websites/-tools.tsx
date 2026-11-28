import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import { ErrorNotice } from '@/components/ErrorNotice'
import type { ServerSummary } from '@/components/ServerStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTime } from '@/lib/format'

import { Field } from '../proxy/-shared'
import { Fields } from '../servers/-shared'
import { templatesQuery, useWebsiteRefresh } from './-sites'

// 网站页的「扫描」「校验」「模板」（web-console「网站页」，m2-22 design 第 4 条）。扫描与校验对页面顶部选中的服务器做，
// 没选时不发请求；模板第一次打开时才请求。

interface ScannedSite {
  website_id?: number
  domain: string
  conf_path: string
  managed: boolean
  type: string
  target?: string
  listen_ports: string[] | null
  has_ssl: boolean
  root?: string
  proxy_pass?: string
}

interface ScanView {
  server: string
  total: number
  managed: ScannedSite[] | null
  unmanaged: ScannedSite[] | null
  missing?: string[] | null
  scanned_at: string
}

interface ValidateView {
  server: string
  ok: boolean
  reachable: boolean
  latency_ms: number
  tls_version?: string
  alpn?: string
  http2: boolean
  cert_valid: boolean
  cert_subject?: string
  cert_issuer?: string
  cert_dns_names?: string[] | null
  cert_expires_at?: string | null
  cert_days_left?: number
  http_status?: number
  server_header?: string
  reality_suitable: boolean
  error?: string
  checked_at: string
}

function NeedServer() {
  const { t } = useTranslation('websites')
  return <p className="text-muted-foreground text-sm">{t('server.required')}</p>
}

export function ScanTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('websites')
  const refresh = useWebsiteRefresh()
  const scan = useMutation({ mutationFn: (name: string) => run<ScanView>('website scan', { args: [name] }), onSuccess: refresh })
  const r = scan.data
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardDescription>{t('scan.description')}</CardDescription>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!server || scan.isPending} onClick={() => server && scan.mutate(server.name)}>
            {t('scan.button')}
          </Button>
          {!server && <NeedServer />}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ErrorNotice error={scan.error} />
        {r && (
          <div className="grid gap-4" data-testid="scan-result">
            <p className="text-sm">{t('scan.summary', { time: formatTime(r.scanned_at), total: r.total })}</p>
            <section className="grid gap-2">
              <h3 className="text-sm font-medium">{t('scan.managed')}</h3>
              <SiteTable sites={r.managed ?? []} managed />
            </section>
            <section className="grid gap-2" data-testid="scan-unmanaged">
              <h3 className="text-sm font-medium">{t('scan.unmanaged')}</h3>
              <p className="text-muted-foreground text-xs">{t('scan.unmanagedNote')}</p>
              <SiteTable sites={r.unmanaged ?? []} />
            </section>
            {(r.missing ?? []).length > 0 && <p className="text-sm">{t('scan.missing', { domains: (r.missing ?? []).join(', ') })}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// SiteTable：已纳管的列站点编号、监听端口与这份配置是不是 Satchel 生成的（同域名的手写配置也在里面，managed 为假），
// 未纳管的列类型与根目录或上游。
function SiteTable({ sites, managed }: { sites: ScannedSite[]; managed?: boolean }) {
  const { t } = useTranslation('websites')
  if (sites.length === 0) return <p className="text-muted-foreground text-sm">{t('scan.empty')}</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {managed && <TableHead>{t('cols.websiteId')}</TableHead>}
          <TableHead>{t('cols.domain')}</TableHead>
          <TableHead>{t('cols.confPath')}</TableHead>
          {managed ? <TableHead>{t('cols.listenPorts')}</TableHead> : <TableHead>{t('cols.type')}</TableHead>}
          {!managed && <TableHead>{t('cols.rootOrUpstream')}</TableHead>}
          {managed && <TableHead>{t('cols.generated')}</TableHead>}
          <TableHead>{t('cols.ssl')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map((s) => (
          <TableRow key={s.conf_path + s.domain} data-testid={`scan-row-${s.conf_path}`}>
            {managed && <TableCell className="font-mono">{s.website_id}</TableCell>}
            <TableCell className="font-mono">{s.domain}</TableCell>
            <TableCell className="font-mono text-xs break-all whitespace-normal">{s.conf_path}</TableCell>
            {managed ? (
              <TableCell>{(s.listen_ports ?? []).join(', ') || t('none')}</TableCell>
            ) : (
              <TableCell>{t(`types.${s.type}` as 'types.static', { defaultValue: s.type })}</TableCell>
            )}
            {!managed && <TableCell className="font-mono text-xs break-all whitespace-normal">{s.root || s.proxy_pass || s.target || t('none')}</TableCell>}
            {managed && <TableCell>{s.managed ? t('yes') : t('no')}</TableCell>}
            <TableCell>{s.has_ssl ? t('yes') : t('no')}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function ValidateTab({ server }: { server: ServerSummary | null }) {
  const { t } = useTranslation('websites')
  const [domain, setDomain] = useState('')
  const [port, setPort] = useState('443')
  const [sni, setSni] = useState('')
  const [seconds, setSeconds] = useState('10')
  const check = useMutation({
    mutationFn: (name: string) =>
      run<ValidateView>('website validate', {
        args: [name],
        flags: { domain: domain.trim(), port: Number(port) || 443, sni: sni.trim() || undefined, timeout: `${Number(seconds) || 10}s` },
      }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (server) check.mutate(server.name)
  }
  const r = check.data
  const yesNo = (v: boolean) => (v ? t('yes') : t('no'))
  const rows: [string, ReactNode][] = r
    ? [
        [t('validate.result'), <Badge variant={r.ok ? 'default' : 'destructive'}>{r.ok ? t('validate.ok') : t('validate.fail')}</Badge>],
        [t('validate.reality'), <Badge variant={r.reality_suitable ? 'default' : 'outline'}>{r.reality_suitable ? t('validate.realityOk') : t('validate.realityNo')}</Badge>],
        [t('validate.reachable'), yesNo(r.reachable)],
        ...(r.reachable ? [[t('validate.latency'), t('validate.latencyValue', { ms: r.latency_ms })] as [string, ReactNode]] : []),
        ...(r.tls_version ? [[t('validate.tlsVersion'), r.tls_version] as [string, ReactNode]] : []),
        ...(r.alpn ? [[t('validate.alpn'), r.alpn] as [string, ReactNode]] : []),
        [t('validate.http2'), yesNo(r.http2)],
        [t('validate.certValid'), yesNo(r.cert_valid)],
        ...(r.cert_subject ? [[t('validate.certSubject'), r.cert_subject] as [string, ReactNode]] : []),
        ...(r.cert_issuer ? [[t('validate.certIssuer'), r.cert_issuer] as [string, ReactNode]] : []),
        ...((r.cert_dns_names ?? []).length > 0 ? [[t('validate.certDnsNames'), (r.cert_dns_names ?? []).join(', ')] as [string, ReactNode]] : []),
        ...(r.cert_expires_at ? [[t('validate.certExpires'), t('validate.certExpiresValue', { time: formatTime(r.cert_expires_at), days: r.cert_days_left ?? 0 })] as [string, ReactNode]] : []),
        ...(r.http_status ? [[t('validate.httpStatus'), r.http_status] as [string, ReactNode]] : []),
        ...(r.server_header ? [[t('validate.serverHeader'), r.server_header] as [string, ReactNode]] : []),
        ...(r.error ? [[t('validate.error'), <span className="break-all">{r.error}</span>] as [string, ReactNode]] : []),
        [t('validate.checkedAt'), formatTime(r.checked_at)],
      ]
    : []
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardDescription>{t('validate.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_6rem_1fr_6rem_auto] sm:items-end" onSubmit={submit}>
          <Field id="validate-domain" label={t('validate.domain')}>
            <Input id="validate-domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
          </Field>
          <Field id="validate-port" label={t('validate.port')}>
            <Input id="validate-port" type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
          <Field id="validate-sni" label={t('validate.sni')}>
            <Input id="validate-sni" value={sni} placeholder={t('validate.sniPlaceholder')} onChange={(e) => setSni(e.target.value)} />
          </Field>
          <Field id="validate-timeout" label={t('validate.timeout')}>
            <Input id="validate-timeout" type="number" min={1} max={30} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!server || domain.trim() === '' || check.isPending}>
            {t('validate.button')}
          </Button>
        </form>
        {!server && <NeedServer />}
        <ErrorNotice error={check.error} />
        {r && (
          <div data-testid="validate-result">
            <Fields rows={rows} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function TemplatesTab({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('websites')
  const list = useQuery({ ...templatesQuery, enabled })
  const d = list.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('tabs.templates')}</CardTitle>
        <CardDescription>{t('templates.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ErrorNotice error={list.error} />
        {d && (
          <>
            <Table data-testid="website-templates">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('templates.id')}</TableHead>
                  <TableHead>{t('cols.type')}</TableHead>
                  <TableHead>{t('templates.name')}</TableHead>
                  <TableHead>{t('templates.desc')}</TableHead>
                  <TableHead>{t('templates.targetFormat')}</TableHead>
                  <TableHead>{t('templates.example')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(d.templates ?? []).map((x) => (
                  <TableRow key={x.id} data-testid={`template-${x.id}`}>
                    <TableCell className="font-mono">{x.id}</TableCell>
                    <TableCell>{t(`types.${x.type}` as 'types.static', { defaultValue: x.type })}</TableCell>
                    <TableCell>{x.display_name}</TableCell>
                    <TableCell className="max-w-80 whitespace-normal">{x.description}</TableCell>
                    <TableCell className="font-mono text-xs">{x.target_format}</TableCell>
                    <TableCell className="font-mono text-xs">{x.example_target}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(d.rules ?? []).length > 0 && (
              <section className="grid gap-1 text-sm">
                <h3 className="font-medium">{t('templates.rules')}</h3>
                <ul className="list-disc pl-5">
                  {(d.rules ?? []).map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
