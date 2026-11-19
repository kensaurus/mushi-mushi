/**
 * FILE: apps/admin/src/components/health/PlatformDoctorCard.tsx
 * PURPOSE: The server doctor on /health, for the Mushi operator only
 *          (super-admin). GET /v1/admin/doctor already backs `mushi doctor
 *          --server`; super-admins now also get the platform checks there:
 *          server secrets no app owner can set (Slack and Linear OAuth, Slack
 *          signing), named as present or missing, never their values (console
 *          ops plan 2026-10-27, P1; report 2d5e2bd7). App owners never see
 *          this card, and their Set up page never lists these.
 *
 *          Layout (2026-11-19): problems first, each with its mark, the app's
 *          name (never `codebase_index:<uuid>`), a one-line fix and the button
 *          that does it; optional extras and passing checks collapse into
 *          "N optional ▸" and "N checks OK ▸". The raw check id sits in the
 *          row's tooltip.
 */

import { useState } from 'react'
import { useEntitlements } from '../../lib/useEntitlements'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { describeApiFailure } from '../../lib/humanizeApiError'
import {
  doctorAction,
  doctorTitle,
  DOCTOR_RUN_STATUS,
  orderDoctorChecks,
  splitDoctorChecks,
  type DoctorCheck,
  type DoctorReport,
} from '../../lib/doctorView'
import { StatusMark, StatusPill } from '../signal/StatusMark'
import { Btn, ErrorAlert, Loading, Section } from '../ui'

/** @internal Exported for tests (the order now lives in lib/doctorView). */
export { orderDoctorChecks }

export function PlatformDoctorCard() {
  const { isSuperAdmin } = useEntitlements()
  const page = usePageData<DoctorReport>(isSuperAdmin ? '/v1/admin/doctor' : null, { scope: 'none' })
  if (!isSuperAdmin) return null
  const { problems, optional, ok } = splitDoctorChecks(page.data?.checks ?? [])

  return (
    <Section id="server-doctor" title="Server doctor (only you see this)" freshness={{ at: page.lastFetchedAt, isValidating: page.isValidating }}>
      <div data-testid="platform-doctor">
        {page.loading && !page.data ? (
          <Loading text="Running the server checks…" />
        ) : page.error && !page.data ? (
          <ErrorAlert title="Server doctor" message={page.error} onRetry={page.reload} />
        ) : (
          <>
            {problems.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-st-passed-ink" data-testid="doctor-all-clear">
                <StatusMark status="passed" />
                No server problems.
              </p>
            ) : (
              <ul className="divide-y divide-edge-subtle" aria-label="Problems">
                {problems.map((c) => (
                  <DoctorRow key={c.name} check={c} onFixed={page.reload} />
                ))}
              </ul>
            )}
            <Collapsed label={`${optional.length} optional, not set up`} checks={optional} onFixed={page.reload} testId="doctor-optional" />
            <Collapsed label={`${ok.length} checks OK`} checks={ok} onFixed={page.reload} testId="doctor-ok" />
            <p className="mt-2 text-2xs text-fg-muted">Server secrets are named as set or missing, never shown. Set them as Supabase function secrets.</p>
          </>
        )}
      </div>
    </Section>
  )
}

function Collapsed({ label, checks, onFixed, testId }: { label: string; checks: DoctorCheck[]; onFixed: () => void; testId: string }) {
  if (checks.length === 0) return null
  return (
    <details className="group mt-1.5" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-xs font-semibold text-fg-secondary hover:text-fg">
        <StatusMark status={DOCTOR_RUN_STATUS[checks[0]?.status ?? 'pass']} size={10} />
        {label}
        <span aria-hidden className="text-fg-faint transition-transform group-open:rotate-90">▸</span>
      </summary>
      <ul className="divide-y divide-edge-subtle border-t border-edge-subtle">
        {checks.map((c) => (
          <DoctorRow key={c.name} check={c} onFixed={onFixed} />
        ))}
      </ul>
    </details>
  )
}

function DoctorRow({ check, onFixed }: { check: DoctorCheck; onFixed: () => void }) {
  const action = doctorAction(check)
  const showHint = check.hint && check.status !== 'pass'
  return (
    <li className="flex min-w-0 items-start gap-2 py-1.5" data-testid={`doctor-check-${check.name}`}>
      <StatusMark status={DOCTOR_RUN_STATUS[check.status]} label={check.status} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span className="font-semibold text-fg" title={check.name}>
            {doctorTitle(check)}
          </span>
          {check.appName ? <StatusPill status="idle" label={check.appName} /> : null}
        </p>
        <p className="text-xs text-fg-secondary break-words">{check.summary}</p>
        {showHint ? <p className="mt-0.5 text-2xs text-fg-muted break-words">→ {check.hint}</p> : null}
      </div>
      {action ? <ActionButton action={action} onFixed={onFixed} /> : null}
    </li>
  )
}

function ActionButton({ action, onFixed }: { action: NonNullable<ReturnType<typeof doctorAction>>; onFixed: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  if (action.kind === 'link') {
    return (
      <Btn to={action.to} size="sm" variant="ghost" className="shrink-0">
        {action.label}
      </Btn>
    )
  }
  async function reindex() {
    if (action.kind !== 'reindex') return
    setBusy(true)
    const res = await apiFetch(`/v1/admin/projects/${action.projectId}/codebase/sweep`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const t = describeApiFailure(res.error, 'Could not start indexing')
      toast.error(t.title, t.description)
      return
    }
    toast.success('Indexing started', 'The code index fills over the next minutes.')
    onFixed()
  }
  return (
    <Btn size="sm" variant="ghost" className="shrink-0" loading={busy} onClick={() => void reindex()}>
      {action.label}
    </Btn>
  )
}
