import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { run } from '@/api/client'
import { ErrorNotice } from '@/components/ErrorNotice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

import { protocolsQuery } from './-inbounds'
import { CopyRows, Field, pretty } from './-shared'

// 代理页的「参考」（web-console「代理页」，m2-18 design 第 12 条）：协议矩阵与示例在第一次打开这一页时请求（只读、不含密钥）；
// 密钥生成点了才请求，不进浏览器缓存。

interface InboundExample {
  id: string
  title: string
  protocol: string
  transport: string
  security: string
  description: string
  spec: unknown
  plan_op?: unknown
}

const KEY_TYPES = ['all', 'uuid', 'x25519', 'short-id', 'password', 'ss2022', 'wireguard'] as const
type KeyType = (typeof KEY_TYPES)[number]
const SS2022_CIPHERS = ['2022-blake3-aes-128-gcm', '2022-blake3-aes-256-gcm', '2022-blake3-chacha20-poly1305'] as const

export function ReferenceTab({ enabled }: { enabled: boolean }) {
  return (
    <div className="grid gap-4">
      <Protocols enabled={enabled} />
      <Examples enabled={enabled} />
      <Keygen />
    </div>
  )
}

function Protocols({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('proxy')
  const matrix = useQuery({ ...protocolsQuery, enabled })
  const m = matrix.data
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('reference.protocolsTitle')}</CardTitle>
        {m && <CardDescription>{t('reference.kernel', { version: m.kernel_version })}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={matrix.error} />
        {m && (
          <>
            <Table data-testid="protocol-matrix">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('cols.protocol')}</TableHead>
                  <TableHead>{t('reference.category')}</TableHead>
                  <TableHead>{t('reference.transports')}</TableHead>
                  <TableHead>{t('reference.securities')}</TableHead>
                  <TableHead>{t('reference.auth')}</TableHead>
                  <TableHead>{t('reference.required')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {m.native.map((p) => (
                  <TableRow key={p.protocol} data-testid={`protocol-${p.protocol}`}>
                    <TableCell>
                      <div className="font-mono">{p.protocol}</div>
                      <div className="text-muted-foreground text-xs">{p.display_name}</div>
                      {p.notes && <div className="text-muted-foreground text-xs">{p.notes}</div>}
                    </TableCell>
                    <TableCell>{p.category}</TableCell>
                    <TableCell className="font-mono text-xs">{p.transports.join(', ')}</TableCell>
                    <TableCell className="font-mono text-xs">{p.securities.join(', ')}</TableCell>
                    <TableCell className="text-xs">{p.auth_model}</TableCell>
                    <TableCell className="font-mono text-xs">{p.required_fields.join(', ') || t('none')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="grid gap-1 text-sm">
              <p className="font-medium">{t('reference.parallel')}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {m.parallel_track.map((p) => (
                  <li key={p.protocol}>
                    {t('reference.parallelItem', { protocol: p.protocol, notes: p.notes })}
                  </li>
                ))}
              </ul>
              <p className="font-medium">{t('reference.unsupported')}</p>
              <ul className="text-muted-foreground list-disc pl-5">
                {m.unsupported.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

interface ExampleFilter {
  protocol: string
  transport: string
  security: string
}

const EMPTY_FILTER: ExampleFilter = { protocol: '', transport: '', security: '' }

function Examples({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation('proxy')
  const [draft, setDraft] = useState<ExampleFilter>(EMPTY_FILTER)
  const [filter, setFilter] = useState<ExampleFilter>(EMPTY_FILTER)
  const examples = useQuery({
    queryKey: ['inbound examples', filter],
    queryFn: () =>
      run<{ items: InboundExample[]; total: number }>('inbound examples', {
        flags: { protocol: filter.protocol || undefined, transport: filter.transport || undefined, security: filter.security || undefined },
      }),
    enabled,
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setFilter({ protocol: draft.protocol.trim(), transport: draft.transport.trim(), security: draft.security.trim() })
  }
  const input = (k: keyof ExampleFilter) => (
    <Field key={k} id={`example-${k}`} label={t(`reference.filter.${k}` as 'reference.filter.protocol')}>
      <Input id={`example-${k}`} className="w-36" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
    </Field>
  )
  return (
    <Card className="shadow-flat">
      <CardHeader className="grid gap-3">
        <CardTitle>{t('reference.examplesTitle')}</CardTitle>
        <Alert>
          <AlertDescription>{t('reference.placeholderKeys')}</AlertDescription>
        </Alert>
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          {input('protocol')}
          {input('transport')}
          {input('security')}
          <Button type="submit" variant="outline">
            {t('search')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ErrorNotice error={examples.error} />
        {examples.data && examples.data.items.length === 0 && <p className="text-muted-foreground text-sm">{t('reference.noExamples')}</p>}
        {examples.data?.items.map((ex) => (
          <details key={ex.id} className="rounded-md border p-3" data-testid={`example-${ex.id}`}>
            <summary className="cursor-pointer text-sm">
              <span className="font-medium">{ex.title}</span>
              <span className="text-muted-foreground ml-2 font-mono text-xs">{[ex.protocol, ex.transport, ex.security].filter(Boolean).join(' / ')}</span>
            </summary>
            <p className="text-muted-foreground mt-2 text-sm">{ex.description}</p>
            <pre className="bg-muted mt-2 max-h-96 overflow-auto rounded-md p-3 font-mono text-xs">{pretty(ex.plan_op ?? ex.spec)}</pre>
          </details>
        ))}
      </CardContent>
    </Card>
  )
}

function Keygen() {
  const { t } = useTranslation('proxy')
  const [type, setType] = useState<KeyType>('all')
  const [cipher, setCipher] = useState<string>(SS2022_CIPHERS[0])
  const gen = useMutation({
    mutationFn: () => run<Record<string, unknown>>('inbound keygen', { flags: { type, cipher: type === 'ss2022' || type === 'all' ? cipher : undefined }, noStore: true }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    gen.mutate()
  }
  // 回应里的 type 是请求的类型，不是生成的值
  const values = Object.fromEntries(Object.entries(gen.data ?? {}).filter(([k]) => k !== 'type'))
  return (
    <Card className="shadow-flat">
      <CardHeader>
        <CardTitle>{t('reference.keygenTitle')}</CardTitle>
        <CardDescription>{t('reference.keygenDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <Field id="keygen-type" label={t('reference.keyType')}>
            <Select value={type} onValueChange={(v) => setType(v as KeyType)}>
              <SelectTrigger id="keygen-type" aria-label={t('reference.keyType')} className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEY_TYPES.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`reference.keyTypes.${k}` as 'reference.keyTypes.all')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {(type === 'ss2022' || type === 'all') && (
            <Field id="keygen-cipher" label={t('reference.cipher')}>
              <Select value={cipher} onValueChange={setCipher}>
                <SelectTrigger id="keygen-cipher" aria-label={t('reference.cipher')} className="w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SS2022_CIPHERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Button type="submit" disabled={gen.isPending}>
            {t('reference.generate')}
          </Button>
        </form>
        <ErrorNotice error={gen.error} />
        {gen.data && (
          <div data-testid="keygen-result">
            <CopyRows values={values} label={(k) => t(`keys.${k}` as 'keys.uuid', { defaultValue: k })} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
