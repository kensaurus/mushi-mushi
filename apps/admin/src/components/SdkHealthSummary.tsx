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

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Btn, Badge, DetailRows } from './ui'
import { ContainedBlock, SignalChip } from './report-detail/ReportSurface'
import { IconHealth, IconNetwork, IconGlobe, IconKey } from './icons'
import { apiFetch } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { SetupStep } from '../lib/useSetupStatus'
import {
  formatEnvVarPair,
  mushiEnvVarsForProjectSlug,
  isExpoReporterProject,
  expoReporterGithubRepo,
  type ProjectMushiEnvVars,
} from '../lib/projectMushiEnv'
import { sdkPlatformHintFromUserAgent, sdkOriginKind } from '../lib/sdkClientPlatform'
import { CHIP_TONE } from '../lib/chipTone'

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
  /** Project slug drives stack-accurate env-var names in diagnostics. */
  projectSlug?: string | null
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
  env: ProjectMushiEnvVars = mushiEnvVarsForProjectSlug(null),
): KeyDiagnostic {
  const envPair = formatEnvVarPair(env)
  const envHint = env.envFileHint ? ` in ${env.envFileHint}` : ' in your build env'
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
      label: 'Never used',
      description:
        `The SDK using this key has not authenticated yet. Most common cause: ${envPair} are missing${envHint} (${env.stackLabel}) — without them, isEnabled() returns false and the SDK never heartbeats.`,
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
      label: 'Mismatch',
      description: `Your SDK is reaching ${k.last_seen_endpoint_host}, but this admin reads from ${adminHost}. Check ${env.endpointVar ?? 'your Mushi API endpoint env var'} in your build env — a stale staging or localhost endpoint is the most common cause.`,
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
  env: ProjectMushiEnvVars = mushiEnvVarsForProjectSlug(null),
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
    const d = diagnoseKey(k, adminHost, env)
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

/** Short pill text — one or two words; long copy lives in `description` / tooltips. */
export const SDK_CARD_CHIP_LABEL: Record<CardStatus, string> = {
  healthy: 'Connected',
  'endpoint-mismatch': 'Mismatch',
  stale: 'Stale',
  cold: 'Cold',
  never: 'Never used',
  'no-key': 'No key',
}

const STATUS_TONE: Record<CardStatus, { dot: string; chip: string; headline: string; subtitle: string }> = {
  healthy: {
    dot: 'bg-ok',
    chip: CHIP_TONE.okSubtle,
    headline: 'Feedback widget is connected',
    subtitle: 'Your app is checking in — new bug reports should appear within seconds.',
  },
  'endpoint-mismatch': {
    dot: 'bg-danger',
    chip: CHIP_TONE.dangerSubtle,
    headline: 'SDK is pointed at the wrong backend',
    subtitle: 'Reports may be landing somewhere else. Fix your API endpoint env var and rebuild.',
  },
  stale: {
    dot: 'bg-warn',
    chip: CHIP_TONE.warnSubtle,
    headline: 'App has not checked in recently',
    subtitle: 'Normal for low-traffic apps. If you just shipped an update, confirm SDK env vars are still in the build.',
  },
  cold: {
    dot: 'bg-warn',
    chip: CHIP_TONE.warnSubtle,
    headline: 'No app activity in 7+ days',
    subtitle: 'The SDK may have been removed from a recent deploy, or the API key was rotated.',
  },
  never: {
    dot: 'bg-danger',
    chip: CHIP_TONE.dangerSubtle,
    headline: 'SDK not connected yet',
    subtitle: 'Your API key exists but your app has never used it — usually missing env vars in the build.',
  },
  'no-key': {
    dot: 'bg-fg-faint',
    chip: 'bg-surface-overlay text-fg-muted border border-edge-subtle',
    headline: 'No API key yet',
    subtitle: 'Generate a key above, then add it to your app config.',
  },
}

const KEY_STATUS_CHIP: Record<
  KeyDiagnostic['status'],
  'ok' | 'warn' | 'danger' | 'neutral'
> = {
  healthy: 'ok',
  'endpoint-mismatch': 'danger',
  stale: 'warn',
  cold: 'warn',
  never: 'danger',
  inactive: 'neutral',
}

const CARD_BLOCK_TONE: Record<
  CardStatus,
  'muted' | 'ok' | 'warn' | 'danger'
> = {
  healthy: 'ok',
  'endpoint-mismatch': 'danger',
  stale: 'warn',
  cold: 'warn',
  never: 'danger',
  'no-key': 'muted',
}

function humanOriginLabel(origin: string | null | undefined): string | null {
  if (!origin?.trim()) return null
  const kind = sdkOriginKind(origin)
  if (kind === 'web') {
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return 'Local dev (browser)'
    try {
      return `Web app (${new URL(origin).host})`
    } catch {
      return 'Web app'
    }
  }
  if (origin.startsWith('capacitor://')) return 'Native app (Capacitor)'
  if (origin.startsWith('android-app://')) return 'Native app (Android)'
  return origin.length > 48 ? `${origin.slice(0, 45)}…` : origin
}

function humanKeySummary(
  k: SdkHealthApiKey,
  d: KeyDiagnostic,
  adminHost: string | null,
): string {
  if (d.status === 'never') {
    return 'This key has never been used by your app — add SDK env vars and rebuild.'
  }
  if (d.status === 'endpoint-mismatch' && k.last_seen_endpoint_host && adminHost) {
    return `Your app is sending data to ${k.last_seen_endpoint_host}, but this project reads from ${adminHost}.`
  }
  const when = k.last_seen_at ? relTime(k.last_seen_at) : 'never'
  const platform = sdkPlatformHintFromUserAgent(k.last_seen_user_agent)
  const where = humanOriginLabel(k.last_seen_origin)
  const parts = [`Last heard from your app ${when}`]
  if (platform) parts.push(platform)
  else if (where) parts.push(where)
  return parts.join(' · ')
}

function SdkKeyHumanRow({
  apiKey: k,
  adminHost,
  envVars,
}: {
  apiKey: SdkHealthApiKey
  adminHost: string | null
  envVars: ProjectMushiEnvVars
}) {
  const d = diagnoseKey(k, adminHost, envVars)
  const summary = humanKeySummary(k, d, adminHost)
  const showMismatch =
    d.status === 'endpoint-mismatch' && k.last_seen_endpoint_host && adminHost

  return (
    <div className="border-t border-edge-subtle/40 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <IconKey className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
            <code className="truncate font-mono text-xs font-medium text-fg" title={k.label ?? k.key_prefix}>
              {k.label?.trim() || `${k.key_prefix}…`}
            </code>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-fg-secondary">{summary}</p>
          {showMismatch ? (
            <p className="mt-1 text-2xs text-danger">
              Expected backend: <span className="font-mono">{adminHost}</span>
            </p>
          ) : null}
        </div>
        <SignalChip tone={KEY_STATUS_CHIP[d.status]} className="shrink-0 whitespace-nowrap">
          {d.label}
        </SignalChip>
      </div>
    </div>
  )
}
function keyHeartbeatTitle(k: SdkHealthApiKey, d: KeyDiagnostic): string {
  const parts: string[] = [d.description]
  if (k.last_seen_at) parts.push(`Last seen ${absTime(k.last_seen_at)}`)
  const platform = sdkPlatformHintFromUserAgent(k.last_seen_user_agent)
  if (platform) parts.push(platform)
  if (k.last_seen_user_agent) parts.push(k.last_seen_user_agent)
  return parts.join(' · ')
}

function SdkKeyCompactTableRow({
  apiKey: k,
  adminHost,
  envVars,
}: {
  apiKey: SdkHealthApiKey
  adminHost: string | null
  envVars: ProjectMushiEnvVars
}) {
  const d = diagnoseKey(k, adminHost, envVars)
  const endpointMatches =
    k.last_seen_endpoint_host && adminHost && k.last_seen_endpoint_host === adminHost

  return (
    <tr className="border-t border-edge-subtle/40">
      <td className="px-3 py-2.5 align-middle">
        <div className="flex min-w-0 items-center gap-2">
          <IconKey className="h-4 w-4 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0">
            <code
              className="block truncate font-mono text-xs font-medium text-fg"
              title={k.label ?? k.key_prefix}
            >
              {k.key_prefix}…
            </code>
            {k.label ? (
              <div className="truncate text-2xs text-fg-muted">{k.label}</div>
            ) : null}
          </div>
        </div>
      </td>
      <td className="border-l border-edge-subtle/45 px-3 py-2.5 align-middle">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconNetwork className="h-4 w-4 shrink-0 text-info" aria-hidden />
          {k.last_seen_endpoint_host ? (
            <code
              className={`min-w-0 truncate font-mono text-xs ${
                endpointMatches ? 'text-fg-secondary' : 'text-danger'
              }`}
              title={
                endpointMatches
                  ? 'Backend your SDK is calling — matches this project'
                  : `Wrong backend — this project reads from ${adminHost ?? 'unknown'}`
              }
            >
              {k.last_seen_endpoint_host}
            </code>
          ) : (
            <span className="text-xs text-fg-faint">—</span>
          )}
        </div>
      </td>
      <td className="border-l border-edge-subtle/45 px-3 py-2.5 align-middle">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconGlobe className="h-4 w-4 shrink-0 text-brand" aria-hidden />
          {k.last_seen_origin ? (
            <code
              className="min-w-0 truncate font-mono text-xs text-fg-secondary"
              title={k.last_seen_origin}
            >
              {humanOriginLabel(k.last_seen_origin) ?? k.last_seen_origin}
            </code>
          ) : (
            <span className="text-xs text-fg-faint">—</span>
          )}
        </div>
      </td>
      <td className="border-l border-edge-subtle/45 px-3 py-2.5 align-middle text-right">
        <span
          title={k.last_seen_at ? keyHeartbeatTitle(k, d) : d.description}
        >
          <SignalChip
            tone={KEY_STATUS_CHIP[d.status]}
            className="whitespace-nowrap"
          >
            {d.label}
          </SignalChip>
        </span>
      </td>
    </tr>
  )
}

function SdkKeyTableRow({
  apiKey: k,
  adminHost,
  envVars,
}: {
  apiKey: SdkHealthApiKey
  adminHost: string | null
  envVars: ProjectMushiEnvVars
}) {
  const d = diagnoseKey(k, adminHost, envVars)
  const endpointMatches =
    k.last_seen_endpoint_host && adminHost && k.last_seen_endpoint_host === adminHost

  return (
    <tr className="border-t border-edge-subtle/40">
      <td className="px-2 py-2 align-middle">
        <code className="font-mono text-2xs text-fg break-all" title={k.label ?? k.key_prefix}>
          {k.key_prefix}…
        </code>
        {k.label && <div className="mt-0.5 text-3xs text-fg-faint break-words">{k.label}</div>}
      </td>
      <td className="px-2 py-2 align-middle whitespace-nowrap">
        <span
          title={k.last_seen_at ? keyHeartbeatTitle(k, d) : d.description}
        >
          <SignalChip tone={KEY_STATUS_CHIP[d.status]}>{d.label}</SignalChip>
        </span>
      </td>
      <td className="px-2 py-2 align-middle whitespace-nowrap text-fg-muted">
        {k.last_seen_at ? (
          <span title={absTime(k.last_seen_at)} className="cursor-help text-fg">
            {relTime(k.last_seen_at)}
          </span>
        ) : (
          <span className="text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        {k.last_seen_endpoint_host ? (
          <code
            className={`font-mono text-2xs break-all ${endpointMatches ? 'text-fg-secondary' : 'text-danger'}`}
            title={
              endpointMatches
                ? 'Matches this admin backend'
                : `MISMATCH — this admin reads from ${adminHost ?? 'unknown'}`
            }
          >
            {endpointMatches ? '✓ ' : '⚠ '}
            {k.last_seen_endpoint_host}
          </code>
        ) : (
          <span className="text-fg-faint">—</span>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        {k.last_seen_origin ? (
          <code className="font-mono text-2xs text-fg-secondary break-all" title={k.last_seen_origin}>
            {k.last_seen_origin}
          </code>
        ) : (
          <span className="text-fg-faint">—</span>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Diagnostic playbooks — fired by the most-severe card status. Each item is
// a one-line, copy-pastable check the user can do RIGHT NOW. Order matters
// (most likely cause first); the user shouldn't have to read all of them.
// ---------------------------------------------------------------------------

function buildPlaybook(
  env: ProjectMushiEnvVars,
  projectSlug?: string | null,
): Record<CardStatus, { title: string; checks: string[]; cta: string | null }> {
  const envPair = formatEnvVarPair(env)
  const envWhere = env.envFileHint ?? 'your CI/build env'
  const endpointVar = env.endpointVar ?? 'your Mushi API endpoint env var'
  const isExpo = env.projectIdVar.startsWith('EXPO_PUBLIC_')
  const ghRepo = expoReporterGithubRepo(projectSlug) ?? 'your-repo'
  const neverChecks =
    isExpo
      ? [
          `Local dev: add ${envPair} to ${envWhere}. Without both, mushiConfig is null and the feedback band never renders.`,
          env.ciVars
            ? `CI / store builds: set GitHub repo ${env.ciVars.projectId.ghKind} ${env.ciVars.projectId.name}, ${env.ciVars.apiKey.ghKind} ${env.ciVars.apiKey.name}${env.ciVars.endpoint ? `, and ${env.ciVars.endpoint.name}` : ''} on ${ghRepo}. See Connect → Setup Copilot or run scripts/setup-yen-yen-reporter-secrets.mjs.`
            : `CI / store builds: mirror ${envPair} into your release workflow env — Expo cannot read secrets at runtime.`,
          'Rebuild required: EXPO_PUBLIC_* is compile-time. OTA updates cannot fix a store build that shipped without keys — trigger release-mobile for Android + iOS.',
          'Reporter vs ingest: EXPO_PUBLIC_MUSHI_API_KEY powers the in-app band. MUSHI_INGEST_KEY is Code Health metrics only — it does not enable the band.',
          'Send test report below proves ingest only — it does not mark SDK installed; you still need a heartbeat from a real TestFlight / Play build.',
        ]
      : [
          `${env.projectIdVar} or ${env.apiKeyVar} are missing in ${envWhere} (${env.stackLabel}) — without them, isEnabled() returns false and the SDK never heartbeats.`,
          'initMushi() is never called from your app entry — usually deferred from providers or app shell after first paint.',
          'Send test report below proves ingest only — it does not mark SDK installed; you still need a heartbeat from a real app build.',
        ]
  return {
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
        `A stale ${endpointVar} is pinned in ${envWhere} — clear it to fall back to the cloud default.`,
        'A local Supabase stack URL (http://localhost:54321/…) baked into a production build by mistake.',
        'A local-only target flag was set in CI without a matching cloud override.',
      ],
      cta: 'Send test report',
    },
    never: {
      title: isExpo ? 'Expo build-time env missing — fix checklist' : 'Most likely causes',
      checks: neverChecks,
      cta: 'Send test report',
    },
    stale: {
      title: 'Diagnostic',
      checks: [
        'SDK has been quiet for more than an hour. Normal for low-traffic apps.',
        `If you deployed recently, confirm ${envPair} are still present in ${envWhere}.`,
      ],
      cta: 'Send test report',
    },
    cold: {
      title: 'Most likely causes',
      checks: [
        `A recent deploy stopped shipping the SDK — confirm ${envPair} are still in ${envWhere}.`,
        'The active key was rotated and the SDK is still using the old one.',
        'The widget was hidden by a route filter and your traffic is now concentrated on those routes.',
      ],
      cta: 'Send test report',
    },
    'no-key': {
      title: 'Get started',
      checks: ['Generate an API key above, then drop it into your SDK config.'],
      cta: null,
    },
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SdkHealthSummary({
  projectId,
  projectName,
  projectSlug,
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
  const envVars = mushiEnvVarsForProjectSlug(projectSlug)
  const status = summarizeCardStatus(apiKeys, adminHost, envVars)
  const [open, setOpen] = useState(status !== 'healthy' && status !== 'no-key')
  const [showTechnical, setShowTechnical] = useState(
    status === 'endpoint-mismatch',
  )

  // Re-open the diagnostics when a refetch degrades the status while the card
  // stays mounted (e.g. endpoint-mismatch detected after a test report).
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev !== status && status !== 'healthy' && status !== 'no-key') {
      setOpen(true)
    }
  }, [status])

  const tone = STATUS_TONE[status]
  const playbook = buildPlaybook(envVars, projectSlug)[status]
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
        'Ingest path verified — appears in /reports within seconds. SDK installed still needs a heartbeat from your app build.',
      )
      onTestReportSent?.()
    } catch (err) {
      toast.error('Test report failed', err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const statusChipLabel = SDK_CARD_CHIP_LABEL[status]

  const inner = (
    <>
      <div
        className={`flex min-w-0 items-start gap-3 border-b border-edge-subtle/40 px-3 py-2.5 ${
          compact ? '' : 'space-y-2'
        }`}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-surface-overlay/80 text-fg-faint">
          <IconHealth className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold leading-snug text-fg">{tone.headline}</p>
            <SignalChip
              tone={
                status === 'healthy'
                  ? 'ok'
                  : status === 'endpoint-mismatch' || status === 'never'
                    ? 'danger'
                    : status === 'stale' || status === 'cold'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {statusChipLabel}
            </SignalChip>
          </div>
          <p className="text-xs leading-relaxed text-fg-secondary">{tone.subtitle}</p>
          {!compact && (
            <p className="mt-1 text-xs text-fg-muted">
              {projectName} ·{' '}
              {reportCount === 0
                ? 'no reports yet'
                : `${reportCount.toLocaleString()} ${reportCount === 1 ? 'report' : 'reports'}`}
              {lastReportAt && ` · last report ${relTime(lastReportAt)}`}
              {freshest?.last_seen_at && ` · last heard from app ${relTime(freshest.last_seen_at)}`}
            </p>
          )}
          {adminHost && (showTechnical || status === 'endpoint-mismatch') && (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
              <IconGlobe className="h-4 w-4 shrink-0 text-info" />
              <span className="shrink-0 font-medium text-fg-muted">This project reads from</span>
              <code
                className="min-w-0 truncate font-mono text-fg"
                title="Backend host for this Mushi project"
              >
                {adminHost}
              </code>
            </div>
          )}
        </div>
      </div>

      {activeKeys.length > 0 && (
        compact ? (
          showTechnical ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] table-fixed border-collapse text-xs">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-[30%]" />
                  <col className="w-[26%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="hidden border-b border-edge-subtle/40 bg-surface-overlay/30 lg:table-header-group">
                  <tr>
                    <th className="px-3 py-2 text-left text-2xs font-semibold text-fg-muted">API key</th>
                    <th className="border-l border-edge-subtle/45 px-3 py-2 text-left text-2xs font-semibold text-fg-muted">
                      Backend called
                    </th>
                    <th className="border-l border-edge-subtle/45 px-3 py-2 text-left text-2xs font-semibold text-fg-muted">
                      App source
                    </th>
                    <th className="border-l border-edge-subtle/45 px-3 py-2 text-right text-2xs font-semibold text-fg-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeKeys.map((k) => (
                    <SdkKeyCompactTableRow
                      key={k.id}
                      apiKey={k}
                      adminHost={adminHost}
                      envVars={envVars}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div>
              {activeKeys.map((k) => (
                <SdkKeyHumanRow
                  key={k.id}
                  apiKey={k}
                  adminHost={adminHost}
                  envVars={envVars}
                />
              ))}
            </div>
          )
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[40rem] text-2xs">
              <thead>
                <tr className="text-fg-faint text-left">
                  <th className="px-2 py-1.5 font-medium font-mono uppercase tracking-wide">Key</th>
                  <th className="px-2 py-1.5 font-medium font-mono uppercase tracking-wide">Status</th>
                  <th className="px-2 py-1.5 font-medium font-mono uppercase tracking-wide">Last seen</th>
                  <th className="px-2 py-1.5 font-medium font-mono uppercase tracking-wide">Endpoint</th>
                  <th className="px-2 py-1.5 font-medium font-mono uppercase tracking-wide">Origin</th>
                </tr>
              </thead>
              <tbody>
                {activeKeys.map((k) => (
                  <SdkKeyTableRow
                    key={k.id}
                    apiKey={k}
                    adminHost={adminHost}
                    envVars={envVars}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-edge-subtle/40 px-3 py-2.5">
        {playbook.cta && (
          <Btn
            size="sm"
            variant="primary"
            loading={sending}
            onClick={sendTestReport}
            title="Sends a synthetic ingest from this admin (proves first report / pipeline). Does not count as SDK installed — that needs a heartbeat from your app build."
          >
            {playbook.cta}
          </Btn>
        )}
        {compact && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => setShowTechnical((v) => !v)}
            aria-expanded={showTechnical}
          >
            {showTechnical ? 'Hide technical details' : 'Show technical details'}
            <span aria-hidden="true" className="ml-1.5">{showTechnical ? '▴' : '▾'}</span>
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={`sdk-health-playbook-${projectId}`}
        >
          {open ? 'Hide fix steps' : 'How to fix'}
          <span aria-hidden="true" className="ml-1.5">{open ? '▴' : '▾'}</span>
        </Btn>
        <Link
          to={isExpoReporterProject(projectSlug) ? '/setup-copilot' : '/onboarding'}
          className="text-2xs text-fg-muted hover:text-fg underline-offset-2 hover:underline ml-auto"
        >
          {isExpoReporterProject(projectSlug) ? 'Setup Copilot →' : 'Setup guide →'}
        </Link>
      </div>

      {open && (
        <div
          id={`sdk-health-playbook-${projectId}`}
          // mushi-mushi-allowlist: hand-rolled surface (cn/template; not Card tile)
          className="mx-3 mb-3 space-y-2 rounded-sm border border-edge-subtle/60 bg-surface-overlay/40 p-3"
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
            <div className="mt-3">
              <DetailRows
                items={[
                  {
                    label: 'SDK is reaching',
                    value: freshest.last_seen_endpoint_host,
                    mono: true,
                    tone: 'danger',
                    wrap: true,
                    copyable: true,
                    hint: 'Endpoint host the embedded SDK is currently posting reports to.',
                  },
                  {
                    label: 'This admin reads from',
                    value: adminHost,
                    mono: true,
                    tone: 'ok',
                    wrap: true,
                    copyable: true,
                    hint: 'Endpoint host this admin console is configured to query.',
                  },
                ]}
              />
            </div>
          )}
        </div>
      )}
    </>
  )

  if (compact) {
    return (
      <ContainedBlock tone={CARD_BLOCK_TONE[status]} className="!p-0 overflow-hidden">
        {inner}
      </ContainedBlock>
    )
  }

  return <Card className="overflow-hidden p-0">{inner}</Card>
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
        <Badge tone="infoSubtle">Connectivity check</Badge>
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
        <Badge tone="infoSubtle">Connectivity check</Badge>
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
