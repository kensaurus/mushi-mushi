/**
 * FILE: apps/admin/src/components/health/PlatformDoctorCard.tsx
 * PURPOSE: The server doctor on /health, for the Mushi operator only
 *          (super-admin). GET /v1/admin/doctor already backs `mushi doctor
 *          --server`; super-admins now also get the platform checks there:
 *          server secrets no app owner can set (Slack and Linear OAuth, Slack
 *          signing), named as present or missing, never their values (console
 *          ops plan 2026-10-27, P1; report 2d5e2bd7). App owners never see
 *          this card, and their Set up page never lists these.
 */

import { useEntitlements } from '../../lib/useEntitlements'
import { usePageData } from '../../lib/usePageData'
import { CHIP_TONE } from '../../lib/chipTone'
import { Badge, ErrorAlert, Loading, Section } from '../ui'

export interface DoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  summary: string
  hint?: string
}

interface DoctorReport {
  status: 'pass' | 'warn' | 'fail'
  checks: DoctorCheck[]
}

const STATUS_CHIP: Record<DoctorCheck['status'], { label: string; cls: string }> = {
  pass: { label: 'OK', cls: CHIP_TONE.okSubtle },
  warn: { label: 'Check', cls: CHIP_TONE.warnSubtle },
  fail: { label: 'Fix', cls: CHIP_TONE.dangerSubtle },
}

const RANK: Record<DoctorCheck['status'], number> = { fail: 0, warn: 1, pass: 2 }

/** @internal Exported for tests. Platform checks first, then the rest; failures first in each. */
export function orderDoctorChecks(checks: DoctorCheck[]): DoctorCheck[] {
  const platform = (c: DoctorCheck) => (c.name.startsWith('platform_') ? 0 : 1)
  return [...checks].sort((a, b) => platform(a) - platform(b) || RANK[a.status] - RANK[b.status])
}

export function PlatformDoctorCard() {
  const { isSuperAdmin } = useEntitlements()
  const page = usePageData<DoctorReport>(isSuperAdmin ? '/v1/admin/doctor' : null, { scope: 'none' })
  if (!isSuperAdmin) return null
  const checks = orderDoctorChecks(page.data?.checks ?? [])

  return (
    <Section id="server-doctor" title="Server doctor (only you see this)" freshness={{ at: page.lastFetchedAt, isValidating: page.isValidating }}>
      <div data-testid="platform-doctor">
        {page.loading && !page.data ? (
          <Loading text="Running the server checks…" />
        ) : page.error && !page.data ? (
          <ErrorAlert title="Server doctor" message={page.error} onRetry={page.reload} />
        ) : (
          <>
            <p className="text-xs text-fg-muted">Server secrets are named as set or missing, never shown. Set them as Supabase function secrets.</p>
            <ul className="mt-2 divide-y divide-edge-subtle">
              {checks.map((c) => (
                <li key={c.name} className="flex min-w-0 items-start gap-2 py-2" data-testid={`doctor-check-${c.name}`}>
                  <Badge className={`${STATUS_CHIP[c.status].cls} shrink-0`}>{STATUS_CHIP[c.status].label}</Badge>
                  <div className="min-w-0">
                    <p className="font-mono text-2xs text-fg-muted break-all">{c.name}</p>
                    <p className="text-xs text-fg break-words">{c.summary}</p>
                    {c.hint ? <p className="mt-0.5 text-2xs text-fg-muted break-words">{c.hint}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Section>
  )
}
