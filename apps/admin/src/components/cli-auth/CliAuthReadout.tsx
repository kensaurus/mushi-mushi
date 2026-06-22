/**
 * FILE: CliAuthReadout.tsx
 * PURPOSE: Device-auth flow endpoints and verification URLs for CLI login approval.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconGlobe, IconTerminal } from '../icons'

function deviceAuthBase(): string {
  const base = RESOLVED_EXTERNAL_API_URL.replace(/\/$/, '')
  return `${base}/v1/cli/auth/device`
}

interface Props {
  userCode: string | null
  fetchedAt?: string | null
}

export function CliAuthReadout({ userCode, fetchedAt }: Props) {
  const approveUrl = typeof window !== 'undefined' ? window.location.href : '/cli-auth'
  const rows: DetailRowItem[] = [
    {
      label: 'User code',
      value: userCode ?? '—',
      mono: true,
      copyable: Boolean(userCode),
      tone: userCode ? 'info' : 'muted',
    },
    {
      label: 'Device poll',
      value: `${deviceAuthBase()}/token`,
      mono: true,
      wrap: true,
    },
    {
      label: 'Approve POST',
      value: `${deviceAuthBase()}/approve`,
      mono: true,
      wrap: true,
    },
  ]

  return (
    <Section title="CLI device auth" freshness={{ at: fetchedAt ?? null }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        RFC 8628 device flow — the CLI polls the token endpoint while you approve here. Do not paste
        the user code into your terminal.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Approval page" url={approveUrl} />
          <EndpointCodeRow label="Ingest API (CLI context)" url={RESOLVED_EXTERNAL_API_URL} />
        </ReadoutSection>
        <ReadoutSection title="Flow refs" icon={<IconTerminal size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
