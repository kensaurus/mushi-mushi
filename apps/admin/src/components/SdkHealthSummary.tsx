/**
 * FILE: apps/admin/src/components/SdkHealthSummary.tsx
 * PURPOSE: Per-project SDK connectivity diagnostic surface. Answers the
 *          single most expensive support question — "I installed the SDK,
 *          why am I seeing 0 reports?" — without making the user grep their
 *          own logs or compare backend hostnames by hand.
 *
 * BACKING DATA (already live in production):
 *   - `project_api_keys.last_seen_at`           — UTC of the SDK's last
 *                                                  authenticated request
 *   - `project_api_keys.last_seen_origin`       — `Origin` header value
 *   - `project_api_keys.last_seen_user_agent`   — UA the SDK sent
 *   - `project_api_keys.last_seen_endpoint_host`— host the SDK addressed
 *   - admin_host (computed once per /v1/admin/projects response from
 *     the request URL) — host THIS admin reads from
 *
 * STATUSES (severity-tinted at the card level + per-key row):
 *   - `healthy`            — heartbeat in the last hour AND endpoint matches
 *   - `endpoint-mismatch`  — heartbeat exists but `last_seen_endpoint_host`
 *                            differs from `admin_host` → the SDK is talking
 *                            to a different backend (staging endpoint stale
 *                            in CI, NEXT_PUBLIC_MUSHI_API_ENDPOINT pointed
 *                            at localhost in dev, etc.)
 *   - `stale`              — heartbeat 1h–7d old → SDK was once connected,
 *                            something probably changed
 *   - `cold`               — heartbeat 7d+ old → likely dead deploy
 *   - `never`              — at least one active key but no heartbeat ever →
 *                            most common cause: env vars missing in CI build
 *                            so the SDK is tree-shaken out of the bundle
 *                            (verified during the 2026-05-07 audit on
 *                            kensaur.us/glot-it: zero "mushi" references in
 *                            the deployed HTML)
 *   - `no-key`             — no active keys at all → user hasn't generated one
 *
 * INTENTIONALLY OUT OF SCOPE (kept lean):
 *   - Realtime websocket — the parent page's reload() is enough; the user
 *     comes here when they're stuck, not for live monitoring.
 *   - Editing the SDK config from here — that lives on the SdkInstallCard
 *     and ProjectsPage already.
 *   - Per-key revoke — already lives on ProjectsPage's key list.
 *
 * Used by:
 *   - ProjectsPage (per-project, primary surface)
 *   - ReportsPage empty-state (when total = 0)
 *   - BillingPage current-plan card (when this-period reports = 0)
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Btn, Badge } from './ui'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { SetupStep } from '../lib/useSetupStatus'

// Heartbeat columns mirror the server-side select in
// routes/billing-projects-queue-graph.ts on /v1/admin/projects.
export interface SdkHealthApiKey {
  id: string
  key_prefix: string
  label?: string | null
  is_active: boolean
  created_at: string
  last_seen_at?: string | null
  last_seen_origin?: string | null
  last_seen_user_agent?: string | null
  last_seen_endpoint_host?: string | null
}

export interface SdkHealthSummaryProps {
  projectId: string
  projectName: string
  apiKeys: SdkHealthApiKey[]
  /** Most recent report's `created_at`, used to differentiate
   *  "auth-only heartbeat" from "actually ingesting reports". */
  lastReportAt: string | null
  /** Admin response's served-from host (e.g. dxptnwrhwsqckaftyymj.supabase.co).
   *  Used to compute the `endpoint-mismatch` status. */
  adminHost: string | null
  /** Total reports for the project — used to label the headline counts. */
  reportCount: number
  /** Compact mode strips the headline + chrome so the card slots into a
   *  page that already has a hero (e.g. ProjectsPage row). */
  compact?: boolean
  /** Called after a successful "Send test report" so the parent can refetch
   *  and the new ingest immediately appears. */
  onTestReportSent?: () => void
}

type CardStatus =
  | 'healthy'
  | 'endpoint-mismatch'
  | 'stale'
  | 'cold'
  | 'never'
  | 'no-key'

interface KeyDiagnostic {
  status: 'healthy' | 'endpoint-mismatch' | 'stale' | 'cold' | 'never' | 'inactive'
  label: string
  description: string
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

// ---------------------------------------------------------------------------
// Pure helpers — colocated so they can be unit-tested without React. The
// status math drives every other piece of UX on the card, so any drift
// (e.g. extending the stale window from 1h to 4h) needs ONE edit, not nine.
// ---------------------------------------------------------------------------

function relTime(input: string | null | undefined): string {
  if (!input) return 'never'
  const ms = Date.now() - new Date(input).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < HOUR_MS) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  if (ms < 30 * DAY_MS) return `${Math.floor(ms / DAY_MS)}d ago`
  return new Date(input).toLocaleDateString()
}

function absTime(input: string | null | undefined): string {
  if (!input) return ''
  const d = new Date(input)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

export function diagnoseKey(
  k: SdkHealthApiKey,
  adminHost: string | null,
): KeyDiagnostic {
  if (!k.is_active) {
    return {
      status: 'inactive',
      label: 'Revoked',
      description: 'Key is no longer active. Mint a new key to bring this surface back to green.',
    }
  }
  if (!k.last_seen_at) {
    return {
      status: 'never',
      label: 'Created · never used',
      description:
        'The SDK using this key has not authenticated yet. Most common cause: the public env vars (NEXT_PUBLIC_MUSHI_PROJECT_ID / NEXT_PUBLIC_MUSHI_API_KEY) are missing in the build that serves your users — without them, the SDK tree-shakes out of the bundle entirely.',
    }
  }
  const age = Date.now() - new Date(k.last_seen_at).getTime()
  // Endpoint comparison wins over recency: a "fresh" heartbeat from the
  // wrong backend is still wrong, and the user needs that called out
  // before they spend an hour debugging quota / CORS / RLS.
  if (
    adminHost &&
    k.last_seen_endpoint_host &&
    k.last_seen_endpoint_host !== adminHost
  ) {
    return {
      status: 'endpoint-mismatch',
      label: 'Wrong backend',
      description: `Your SDK is reaching ${k.last_seen_endpoint_host}, but this admin reads from ${adminHost}. Check NEXT_PUBLIC_MUSHI_API_ENDPOINT in your build env — a stale staging or localhost endpoint is the most common cause.`,
    }
  }
  if (age < HOUR_MS) {
    return {
      status: 'healthy',
      label: 'Healthy',
      description: 'SDK is authenticating against this backend.',
    }
  }
  if (age < 7 * DAY_MS) {
    return {
      status: 'stale',
      label: 'Stale',
      description:
        'No SDK activity in the last hour. This is normal for a low-traffic app; investigate if you expect continuous traffic.',
    }
  }
  return {
    status: 'cold',
    label: 'Cold',
    description:
      'No SDK activity in over 7 days. The deploy may have stopped shipping the SDK, or the key may have been replaced.',
  }
}

export function summarizeCardStatus(
  apiKeys: SdkHealthApiKey[],
  adminHost: string | null,
): CardStatus {
  const active = apiKeys.filter((k) => k.is_active)
  if (active.length === 0) return 'no-key'

  // Aggregate the per-key diagnostic into one card-level severity. Order
  // matters: an endpoint mismatch on ANY active key is louder than a cold
  // sibling, because the mismatch is silently routing real reports to the
  // wrong place.
  let worst: CardStatus = 'never'
  const seen = new Set<KeyDiagnostic['status']>()
  for (const k of active) {
    const d = diagnoseKey(k, adminHost)
    seen.add(d.status)
  }
  if (seen.has('endpoint-mismatch')) worst = 'endpoint-mismatch'
  else if (seen.has('healthy')) worst = 'healthy'
  else if (seen.has('stale')) worst = 'stale'
  else if (seen.has('cold')) worst = 'cold'
  else worst = 'never'
  return worst
}

// ---------------------------------------------------------------------------
// Token map — semantic colour reserved for status only. tier-D admin
// product (per enhance-page-ui), so chrome stays neutral.
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<CardStatus, { dot: string; chip: string; headline: string }> = {
  healthy: {
    dot: 'bg-ok',
    chip: 'bg-ok-muted text-ok border border-ok/30',
    headline: 'SDK is connected to this backend',
  },
  'endpoint-mismatch': {
    dot: 'bg-danger',
    chip: 'bg-danger-muted text-danger border border-danger/30',
    headline: 'SDK is talking to a different backend',
  },
  stale: {
    dot: 'bg-warn',
    chip: 'bg-warn-muted text-warn border border-warn/30',
    headline: 'SDK was last heard from a while ago',
  },
  cold: {
    dot: 'bg-warn',
    chip: 'bg-warn-muted text-warn border border-warn/30',
    headline: 'SDK has been silent for over 7 days',
  },
  never: {
    dot: 'bg-danger',
    chip: 'bg-danger-muted text-danger border border-danger/30',
    headline: 'No SDK has ever connected with this project’s keys',
  },
  'no-key': {
    dot: 'bg-fg-faint',
    chip: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
    headline: 'No active API key — the SDK has nothing to authenticate with',
  },
}

const KEY_STATUS_TONE: Record<KeyDiagnostic['status'], string> = {
  healthy: 'bg-ok-muted text-ok border border-ok/30',
  'endpoint-mismatch': 'bg-danger-muted text-danger border border-danger/30',
  stale: 'bg-warn-muted text-warn border border-warn/30',
  cold: 'bg-warn-muted text-warn border border-warn/30',
  never: 'bg-danger-muted text-danger border border-danger/30',
  inactive: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
}

// ---------------------------------------------------------------------------
// Diagnostic playbooks — fired by the most-severe card status. Each item is
// a one-line, copy-pastable check the user can do RIGHT NOW. Order matters
// (most likely cause first); the user shouldn't have to read all of them.
// ---------------------------------------------------------------------------

const PLAYBOOK: Record<CardStatus, { title: string; checks: string[]; cta: string | null }> = {
  healthy: {
    title: 'Everything green',
    checks: [
      'SDK is authenticating from a recent build.',
      'Endpoint host matches this admin.',
      'New reports should appear in /reports within seconds of submission.',
    ],
    cta: null,
  },
  'endpoint-mismatch': {
    title: 'Most likely causes',
    checks: [
      'A stale NEXT_PUBLIC_MUSHI_API_ENDPOINT is pinned in your .env.local or CI secrets — clear it to fall back to the cloud default.',
      'A local Supabase stack URL (http://localhost:54321/...) baked into a production build by mistake.',
      'NEXT_PUBLIC_MUSHI_TARGET=local was set in CI without a matching cloud override.',
    ],
    cta: 'Send test report',
  },
  never: {
    title: 'Most likely causes',
    checks: [
      'NEXT_PUBLIC_MUSHI_PROJECT_ID or NEXT_PUBLIC_MUSHI_API_KEY are missing in your CI/build env — without them, isEnabled() returns false and the SDK is tree-shaken out of the bundle. View Source on your deployed HTML and grep for "mushi" — zero matches confirms this.',
      'initMushi() is never called from your app entry — usually `deferWork(() => import("./lib/mushi").then((m) => m.initMushi()))` in providers.',
      'The widget host element (#mushi-mushi-widget) is being injected but immediately removed by a global cleanup; check console for "[mushi]" warnings.',
    ],
    cta: 'Send test report',
  },
  stale: {
    title: 'Diagnostic',
    checks: [
      'SDK has been quiet for more than an hour. Normal for low-traffic apps.',
      'If you deployed recently, the new build may have shipped without the env vars — confirm by checking the deployed HTML for "mushi".',
    ],
    cta: 'Send test report',
  },
  cold: {
    title: 'Most likely causes',
    checks: [
      'A recent deploy stopped shipping the SDK — confirm the build env still includes NEXT_PUBLIC_MUSHI_*.',
      'The active key was rotated and the SDK is still using the old one.',
      'The widget was hidden by a route filter (mushiHideOnRoutes) and your traffic is now concentrated on those routes.',
    ],
    cta: 'Send test report',
  },
  'no-key': {
    title: 'Get started',
    checks: ['Generate an API key above, then drop it into your SDK config.'],
    cta: null,
  },
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SdkHealthSummary({
  projectId,
  projectName,
  apiKeys,
  lastReportAt,
  adminHost,
  reportCount,
  compact = false,
  onTestReportSent,
}: SdkHealthSummaryProps) {
  const toast = useToast()
  const [sending, setSending] = useState(false)
  // Diagnostic accordion auto-opens when the status is anything OTHER than
  // healthy — i.e. we expand it precisely when the user has come here to
  // troubleshoot. They can still collapse it if they just want the summary.
  const status = summarizeCardStatus(apiKeys, adminHost)
  const [open, setOpen] = useState(status !== 'healthy' && status !== 'no-key')

  const tone = STATUS_TONE[status]
  const playbook = PLAYBOOK[status]
  const activeKeys = apiKeys.filter((k) => k.is_active)
  const freshest = activeKeys
    .filter((k) => k.last_seen_at)
    .sort((a, b) => (a.last_seen_at! < b.last_seen_at! ? 1 : -1))[0]

  async function sendTestReport() {
    setSending(true)
    try {
      const res = await apiFetch<{ reportId: string; projectName: string }>(
        `/v1/admin/projects/${projectId}/test-report`,
        { method: 'POST' },
      )
      if (!res.ok) throw new Error(res.error?.message ?? 'Send failed')
      toast.success(
        'Test report sent',
        'It exercises the same ingest path as the SDK — appears in /reports within seconds.',
      )
      onTestReportSent?.()
    } catch (err) {
      toast.error('Test report failed', err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  // Compact mode: status row + diagnostic accordion. Used when the parent
  // (ProjectsPage row) already supplies the project headline and we don't
  // want to repaint the project name.
  const Wrapper = compact
    ? (props: { children: React.ReactNode }) => (
        <div className="rounded-sm border border-edge-subtle bg-surface-overlay/30 p-4 space-y-3">
          {props.children}
        </div>
      )
    : (props: { children: React.ReactNode }) => (
        <Card className="p-5 space-y-4">{props.children}</Card>
      )

  return (
    <Wrapper>
      {/* Headline row: status dot, sentence, primary metric. Status comes
          from the per-key worst-case so the headline matches the row tints
          below without the user having to scan the whole table. */}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`mt-1 inline-block h-2.5 w-2.5 rounded-full shrink-0 ${tone.dot}`}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-fg leading-tight">{tone.headline}</p>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs leading-tight font-medium whitespace-nowrap ${tone.chip}`}>
              {status === 'healthy' ? 'Healthy' :
                status === 'endpoint-mismatch' ? 'Mismatch' :
                status === 'stale' ? 'Stale' :
                status === 'cold' ? 'Cold' :
                status === 'never' ? 'Never connected' : 'No key'}
            </span>
          </div>
          <p className="text-fg-muted text-xs mt-1">
            {projectName} · {reportCount === 0 ? 'no reports yet' : `${reportCount.toLocaleString()} ${reportCount === 1 ? 'report' : 'reports'}`}
            {lastReportAt && ` · last report ${relTime(lastReportAt)}`}
            {freshest?.last_seen_at && ` · last SDK ${relTime(freshest.last_seen_at)}`}
          </p>
        </div>
      </div>

      {/* Per-key table. Hidden in true zero-key state; otherwise it's the
          single highest-density block on the card so the user can scan
          which specific key is or isn't healthy. */}
      {activeKeys.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-2xs">
            <thead>
              <tr className="text-fg-faint text-left">
                <th className="px-1 py-1.5 font-medium font-mono uppercase tracking-wide">Key</th>
                <th className="px-1 py-1.5 font-medium font-mono uppercase tracking-wide">Status</th>
                <th className="px-1 py-1.5 font-medium font-mono uppercase tracking-wide">Last seen</th>
                <th className="px-1 py-1.5 font-medium font-mono uppercase tracking-wide">Endpoint</th>
                <th className="px-1 py-1.5 font-medium font-mono uppercase tracking-wide">Origin</th>
              </tr>
            </thead>
            <tbody>
              {activeKeys.map((k) => {
                const d = diagnoseKey(k, adminHost)
                const endpointMatches =
                  k.last_seen_endpoint_host && adminHost && k.last_seen_endpoint_host === adminHost
                return (
                  <tr key={k.id} className="border-t border-edge-subtle/40">
                    <td className="px-1 py-2 align-top">
                      <div className="font-mono text-fg" title={k.label ?? undefined}>
                        {k.key_prefix}…
                      </div>
                      {k.label && <div className="text-fg-faint text-2xs">{k.label}</div>}
                    </td>
                    <td className="px-1 py-2 align-top">
                      <span
                        title={d.description}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-2xs leading-tight font-medium whitespace-nowrap ${KEY_STATUS_TONE[d.status]}`}
                      >
                        {d.label}
                      </span>
                    </td>
                    <td className="px-1 py-2 align-top">
                      {k.last_seen_at ? (
                        <span title={absTime(k.last_seen_at)} className="text-fg cursor-help">
                          {relTime(k.last_seen_at)}
                        </span>
                      ) : (
                        <span className="text-fg-faint">never</span>
                      )}
                    </td>
                    <td className="px-1 py-2 align-top max-w-[12rem]">
                      {k.last_seen_endpoint_host ? (
                        <span
                          className={`font-mono text-2xs truncate inline-flex items-center gap-1 ${endpointMatches ? 'text-fg-muted' : 'text-danger'}`}
                          title={
                            endpointMatches
                              ? 'Matches this admin backend'
                              : `MISMATCH — this admin reads from ${adminHost ?? 'unknown'}`
                          }
                        >
                          <span aria-hidden="true">{endpointMatches ? '✓' : '⚠'}</span>
                          <span className="truncate">{k.last_seen_endpoint_host}</span>
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                    <td className="px-1 py-2 align-top max-w-[10rem]">
                      {k.last_seen_origin ? (
                        <span className="font-mono text-2xs text-fg-muted truncate block" title={k.last_seen_origin}>
                          {k.last_seen_origin}
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action row + diagnostic toggle. The "Diagnose" button is muted on
          healthy projects (the user almost certainly didn't open the card
          to read a green checklist) and auto-expanded otherwise. */}
      <div className="flex items-center gap-2 flex-wrap">
        {playbook.cta && (
          <Btn
            size="sm"
            variant="primary"
            loading={sending}
            onClick={sendTestReport}
            title="Sends a synthetic ingest from this admin to exercise quota → schema → queue → classification end-to-end. Tagged source=admin_test_report so you can filter it out."
          >
            {playbook.cta}
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`sdk-health-playbook-${projectId}`}
        >
          {open ? 'Hide diagnostics' : 'Diagnose connection'}
          <span aria-hidden="true" className="ml-1.5">{open ? '▴' : '▾'}</span>
        </Btn>
        <Link
          to="/onboarding"
          className="text-2xs text-fg-muted hover:text-fg underline-offset-2 hover:underline ml-auto"
        >
          Setup guide →
        </Link>
      </div>

      {open && (
        <div
          id={`sdk-health-playbook-${projectId}`}
          className="rounded-sm border border-edge-subtle/60 bg-surface-overlay/40 p-3 space-y-2"
        >
          <p className="font-medium text-fg-secondary text-xs">{playbook.title}</p>
          <ol className="space-y-1.5 text-xs text-fg-muted">
            {playbook.checks.map((check, i) => (
              <li key={check} className="flex items-start gap-2">
                <span aria-hidden="true" className="font-mono text-fg-faint shrink-0 mt-0.5">
                  {i + 1}.
                </span>
                <span className="leading-relaxed">{check}</span>
              </li>
            ))}
          </ol>
          {/* When endpoint-mismatch, surface the two values inline so the
              fix is one read-and-paste away — no need to drill into a
              tooltip on the table row. */}
          {status === 'endpoint-mismatch' && freshest?.last_seen_endpoint_host && adminHost && (
            <div className="mt-3 pt-2.5 border-t border-edge-subtle/40 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-2xs font-mono">
              <div>
                <div className="text-fg-faint uppercase tracking-wide mb-0.5">SDK is reaching</div>
                <div className="text-danger break-all">{freshest.last_seen_endpoint_host}</div>
              </div>
              <div>
                <div className="text-fg-faint uppercase tracking-wide mb-0.5">This admin reads from</div>
                <div className="text-ok break-all">{adminHost}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tiny meta row — render only in non-compact mode so the card has a
          recognisable footer when it's used as a stand-alone empty state. */}
      {!compact && adminHost && (
        <p className="text-2xs text-fg-faint font-mono">
          Backend: <span className="text-fg-muted">{adminHost}</span>
        </p>
      )}
    </Wrapper>
  )
}

/**
 * Empty-state wrapper — used by /reports and /billing when the project
 * has zero reports. Shows the diagnostic UI inside an editorial card so
 * the user gets the *answer* to "why am I seeing 0 reports?" instead of
 * the generic "install the SDK and trigger a test report" copy that
 * assumes the SDK isn't there at all (which is wrong for the common
 * mismatch / stale / wrong-endpoint cases).
 */
export function SdkHealthEmptyState(props: SdkHealthSummaryProps) {
  return (
    <Card className="p-5 space-y-4 border-dashed">
      <div className="flex items-center gap-2 text-2xs font-mono text-fg-faint uppercase tracking-wide">
        <Badge className="bg-info-muted text-info border border-info/30">Connectivity check</Badge>
        <span>Why this is empty</span>
      </div>
      <SdkHealthSummary {...props} compact />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Lightweight variant — drives off `useSetupStatus` so /reports and /billing
// don't need to fetch /v1/admin/projects (large response, has heavy
// per-project enrichment). Uses the SAME status math as SdkHealthSummary
// so the diagnoses agree across the app.
// ---------------------------------------------------------------------------

export interface SdkConnectivityEmptyStateProps {
  /** The active project's id — used to wire the test-report POST. */
  projectId: string
  /** Project name, for the headline. */
  projectName: string
  /** Most recent report; if non-null we shouldn't be showing an empty
   *  state at all but the prop is here so callers can pass it through
   *  defensively. */
  lastReportAt: string | null
  /** SDK heartbeat diagnostic from `useSetupStatus().getStep('sdk_installed').diagnostic`.
   *  Accepts null because callers commonly pass `getStep(...)?.diagnostic ?? null`
   *  to handle the not-yet-loaded case. */
  diagnostic?: SetupStep['diagnostic'] | null
  /** Admin host from `useSetupStatus().data.admin_endpoint_host`. */
  adminHost: string | null
  /** Optional headline override — defaults to "Why this is empty". */
  headline?: string
  /** Called after a test report is sent so the parent can refetch. */
  onTestReportSent?: () => void
}

/**
 * Render-anywhere connectivity diagnostic for /reports + /billing empty
 * states. Builds a single-row synthetic `apiKeys` array from the setup
 * diagnostic and delegates to SdkHealthSummary so the rendering, status
 * math, and copy stay consistent.
 *
 * Why a wrapper instead of inline fetching: /v1/admin/setup is the only
 * payload Reports/Billing already pay for; /v1/admin/projects is heavier
 * and would add a second round-trip on the cold-start render where we
 * already have the answer.
 */
export function SdkConnectivityEmptyState({
  projectId,
  projectName,
  lastReportAt,
  diagnostic,
  adminHost,
  headline = 'Why this is empty',
  onTestReportSent,
}: SdkConnectivityEmptyStateProps) {
  const syntheticKey: SdkHealthApiKey = {
    id: `setup-${projectId}`,
    key_prefix: 'mushi_xxxx',
    label: 'Most recent SDK heartbeat',
    is_active: true,
    created_at: new Date().toISOString(),
    last_seen_at: diagnostic?.last_sdk_seen_at ?? null,
    last_seen_origin: diagnostic?.last_sdk_origin ?? null,
    last_seen_user_agent: diagnostic?.last_sdk_user_agent ?? null,
    last_seen_endpoint_host: diagnostic?.last_sdk_endpoint_host ?? null,
  }

  return (
    <Card className="p-5 space-y-4 border-dashed">
      <div className="flex items-center gap-2 text-2xs font-mono text-fg-faint uppercase tracking-wide">
        <Badge className="bg-info-muted text-info border border-info/30">Connectivity check</Badge>
        <span>{headline}</span>
      </div>
      <SdkHealthSummary
        projectId={projectId}
        projectName={projectName}
        apiKeys={[syntheticKey]}
        lastReportAt={lastReportAt}
        adminHost={adminHost}
        reportCount={0}
        compact
        onTestReportSent={onTestReportSent}
      />
      <p className="text-2xs text-fg-faint">
        For per-key detail (which API key is active, when each was last seen, where it was last
        reaching us from), see{' '}
        <Link to="/projects" className="underline underline-offset-2 hover:text-fg">
          Projects
        </Link>
        .
      </p>
    </Card>
  )
}
