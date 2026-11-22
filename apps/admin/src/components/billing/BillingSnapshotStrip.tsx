/**
 * FILE: BillingSnapshotStrip.tsx
 * PURPOSE: The top of Billing, under the plan banner: one usage meter per
 *          limit (diagnoses or reports, seats), fixes merged, and the spend cap.
 *          The meters come from billingMeters.ts; a plain count never shows
 *          as a ratio (report 1c802df2: "Fixes · period 4/0").
 */

import { Link } from 'react-router-dom'
import { Section } from '../ui'
import { billingMeters, type MeterTone, type SeatUsage, type UsageMeter } from './billingMeters'
import type { BillingStats } from './types'

interface Props {
  stats: BillingStats
  fetchedAt: string | null
  isValidating?: boolean
  sectionTitle?: string
  /** Seats used against the plan's limit, when the members stats loaded. */
  seats?: SeatUsage | null
}

const BAR: Record<MeterTone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-fg-faint',
}

const VALUE: Record<MeterTone, string> = {
  ok: 'text-fg',
  warn: 'text-warn',
  danger: 'text-danger',
  neutral: 'text-fg',
}

/** One row of meters at xl, however many the plan has (3 or 4). */
const XL_COLS: Record<number, string> = { 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4', 5: 'xl:grid-cols-5' }

// The counts are the whole team's (billing/stats), so the heading says so:
// the app card below has this app's own counts (review 2026-11-18).
export function BillingSnapshotStrip({ stats, fetchedAt, isValidating, sectionTitle = 'Team usage this period', seats = null }: Props) {
  const meters = billingMeters(stats, seats)
  return (
    <Section title={sectionTitle} freshness={{ at: fetchedAt, isValidating }}>
      {/* Flat meters in the one card: no bordered tile inside the card. */}
      <ul aria-label={sectionTitle} className={`grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${XL_COLS[meters.length] ?? 'xl:grid-cols-4'}`}>
        {meters.map((m) => (
          <MeterCard key={m.id} meter={m} />
        ))}
      </ul>
    </Section>
  )
}

function MeterCard({ meter }: { meter: UsageMeter }) {
  const label = meter.to ? (
    <Link to={meter.to} className="hover:text-fg hover:underline underline-offset-2">
      {meter.label}
    </Link>
  ) : (
    meter.label
  )
  return (
    <li className="min-w-0 py-0.5" data-testid={`billing-meter-${meter.id}`}>
      <p className="text-2xs font-medium text-fg-muted">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums leading-tight ${VALUE[meter.tone]}`}>{meter.value}</p>
      {meter.pct != null ? (
        <div
          role="meter"
          aria-label={meter.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter.pct}
          className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
        >
          <div className={`h-full rounded-full ${BAR[meter.tone]}`} style={{ width: `${Math.max(meter.pct, 2)}%` }} />
        </div>
      ) : null}
      <p className="mt-1 text-2xs leading-snug text-fg-muted text-pretty">{meter.detail}</p>
    </li>
  )
}
