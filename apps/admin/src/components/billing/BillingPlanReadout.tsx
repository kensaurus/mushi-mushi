/**
 * FILE: BillingPlanReadout.tsx
 * PURPOSE: Billing plan refs — Stripe portal link and API base as copyable rows.
 */

import { Section } from '../ui'
import { DetailRows, type DetailRowItem } from '../ui/fields'
import { EndpointCodeRow, ReadoutSection } from '../readout'
import { RESOLVED_EXTERNAL_API_URL } from '../../lib/env'
import { IconBilling, IconGlobe } from '../icons'

interface Props {
  planName: string | null
  planSlug: string | null
  stripePortalUrl: string | null
  diagnosesUsed: number | null
  diagnosesLimit: number | null
  fetchedAt: string | null
  isValidating?: boolean
}

export function BillingPlanReadout({
  planName,
  planSlug,
  stripePortalUrl,
  diagnosesUsed,
  diagnosesLimit,
  fetchedAt,
  isValidating,
}: Props) {
  const rows: DetailRowItem[] = [
    {
      label: 'Plan',
      value: planName ?? planSlug ?? '—',
      tone: planSlug ? 'info' : 'muted',
    },
    {
      label: 'Plan slug',
      value: planSlug ?? '—',
      mono: true,
    },
    {
      label: 'Diagnoses this period',
      value:
        diagnosesUsed != null && diagnosesLimit != null
          ? `${diagnosesUsed} / ${diagnosesLimit}`
          : '—',
      tone:
        diagnosesUsed != null && diagnosesLimit != null && diagnosesUsed >= diagnosesLimit
          ? 'warn'
          : 'muted',
    },
  ]

  return (
    <Section title="Billing readout" freshness={{ at: fetchedAt, isValidating }}>
      <p className="mb-4 text-xs leading-relaxed text-fg-muted">
        Plan reference and Stripe self-service portal — copy links for support tickets or CLI billing
        checks.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ReadoutSection title="Endpoints" icon={<IconGlobe size={14} aria-hidden />}>
          <EndpointCodeRow label="Billing API base" url={RESOLVED_EXTERNAL_API_URL} />
          {stripePortalUrl ? (
            <div className="mt-2">
              <EndpointCodeRow label="Stripe customer portal" url={stripePortalUrl} />
            </div>
          ) : null}
        </ReadoutSection>
        <ReadoutSection title="Plan signals" icon={<IconBilling size={14} aria-hidden />}>
          <DetailRows items={rows} dense />
        </ReadoutSection>
      </div>
    </Section>
  )
}
