/**
 * FILE: apps/admin/src/components/SetupChecklist.tsx
 * PURPOSE: Reusable, DB-backed setup checklist primitive used in two modes:
 *            - mode="banner": collapsible card pinned to the top of the
 *              dashboard. Auto-expanded while required steps are incomplete;
 *              collapses to a single-line "Setup complete" pill once `done`.
 *            - mode="wizard": full-page list with inline CTAs, used by the
 *              `/onboarding` page.
 *
 *          Drives every "what should I configure first" surface in the admin so
 *          end users always see one canonical answer instead of guessing.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { SetupProject, SetupStep } from '../lib/useSetupStatus'

interface SetupChecklistProps {
  project: SetupProject
  mode: 'banner' | 'wizard'
  onRefresh?: () => void
  /**
   * Hostname this admin is reading from (from /v1/admin/setup's
   * `admin_endpoint_host`). When the SDK heartbeat shows a different host
   * the `sdk_installed` row renders a backend-mismatch warning instead of
   * silently nagging — the canonical fix for cross-env confusion (e.g.
   * SDK pointed at local Supabase, admin reading cloud).
   */
  adminEndpointHost?: string | null
}

/**
 * Minimal-spec relative-time label tuned for the setup checklist diagnostic.
 * Avoids pulling in date-fns just for one row; collapses to "just now" inside
 * the heartbeat throttle window so concurrent SDK pings don't make the label
 * flip-flop. Returns null on garbage input so callers can fall back gracefully.
 */
function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return null
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (seconds < 30) return 'just now'
  if (seconds < 90) return '1 minute ago'
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)} minutes ago`
  if (seconds < 60 * 90) return '1 hour ago'
  if (seconds < 60 * 60 * 24) return `${Math.round(seconds / 3600)} hours ago`
  if (seconds < 60 * 60 * 36) return '1 day ago'
  return `${Math.round(seconds / 86400)} days ago`
}

export function SetupChecklist({ project, mode, onRefresh, adminEndpointHost }: SetupChecklistProps) {
  const requiredDone = project.required_complete >= project.required_total
  const allDone = project.complete >= project.total
  const pct = Math.round((project.required_complete / Math.max(1, project.required_total)) * 100)
  // Highlight the next required step with a "Do this next" chip + brand ring,
  // mirroring the dashboard HeroIntro language. .
  const nextRequiredId = project.steps.find((s) => s.required && !s.complete)?.id ?? null

  if (mode === 'banner') {
    return (
      <BannerChecklist
        project={project}
        requiredDone={requiredDone}
        allDone={allDone}
        pct={pct}
        nextRequiredId={nextRequiredId}
        onRefresh={onRefresh}
        adminEndpointHost={adminEndpointHost}
      />
    )
  }

  return (
    <WizardChecklist
      project={project}
      requiredDone={requiredDone}
      pct={pct}
      nextRequiredId={nextRequiredId}
      onRefresh={onRefresh}
      adminEndpointHost={adminEndpointHost}
    />
  )
}

interface InternalProps {
  project: SetupProject
  requiredDone: boolean
  pct: number
  nextRequiredId: string | null
  onRefresh?: () => void
  adminEndpointHost?: string | null
}

function BannerChecklist({
  project,
  requiredDone,
  allDone,
  pct,
  nextRequiredId,
  onRefresh,
  adminEndpointHost,
}: InternalProps & { allDone: boolean }) {
  // Default: collapsed once required steps pass OR the user is >=80% through
  // overall setup so the dashboard hero stops fighting a near-complete
  // checklist for attention. .
  const overallPct = project.complete / Math.max(1, project.total)
  const [open, setOpen] = useState(!(requiredDone || overallPct >= 0.8))

  if (!open) {
    const collapsedCopy = allDone
      ? '✓ Setup complete'
      : requiredDone
        ? '✓ All set — optional integrations available'
        : `Setup ${project.required_complete}/${project.required_total} required`
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`mb-4 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-2xs motion-safe:transition-colors ${
          allDone || requiredDone
            ? 'border-ok/30 bg-ok-muted/15 text-ok'
            : 'border-warn/30 bg-warn/10 text-warn'
        } hover:brightness-110`}
        aria-label="Show setup checklist"
      >
        <span className="font-medium">{collapsedCopy}</span>
        <span className="text-3xs text-fg-muted">expand</span>
      </button>
    )
  }

  return (
    <div className={`mb-4 rounded-md border ${requiredDone ? 'border-ok/30 bg-ok-muted/10' : 'border-warn/30 bg-warn/5'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-edge-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${requiredDone ? 'text-ok' : 'text-warn'}`}>
              {requiredDone ? 'Setup complete' : 'Finish setting up Mushi Mushi'}
            </span>
            <span className="text-3xs font-mono text-fg-muted">
              {project.complete}/{project.total} done · {pct}% required
            </span>
          </div>
          <p className="mt-0.5 text-3xs text-fg-muted truncate">
            {requiredDone
              ? 'Optional integrations below unlock auto-fix PRs and BYOK billing.'
              : `Project: ${project.project_name}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-3xs text-fg-muted hover:text-fg-secondary"
              aria-label="Refresh setup status"
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-3xs text-fg-muted hover:text-fg-secondary"
            aria-label="Collapse setup checklist"
          >
            Hide
          </button>
        </div>
      </div>

      {/* progress bar */}
      <div className="px-3 pt-2">
        <div className="h-1 w-full overflow-hidden rounded-sm bg-surface-overlay">
          <div
            className={`h-full ${requiredDone ? 'bg-ok' : 'bg-warn'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <ol className="space-y-1 p-3">
        {project.steps.map(step => (
          <ChecklistRow
            key={step.id}
            step={step}
            current={step.id === nextRequiredId}
            adminEndpointHost={adminEndpointHost}
          />
        ))}
      </ol>
    </div>
  )
}

function WizardChecklist({ project, requiredDone, pct, nextRequiredId, adminEndpointHost }: InternalProps) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-edge-subtle bg-surface-raised/30 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-fg">
            {requiredDone ? 'You\u2019re set up' : 'Setup progress'}
          </span>
          <span className="text-3xs font-mono text-fg-muted">
            {project.required_complete}/{project.required_total} required · {pct}%
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-sm bg-surface-overlay">
          <div
            className={`h-full ${requiredDone ? 'bg-ok' : 'bg-brand'}`}
            style={{ width: `${Math.max(2, pct)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      </div>

      <ol className="space-y-2">
        {project.steps.map(step => (
          <li key={step.id}>
            <ChecklistCard
              step={step}
              current={step.id === nextRequiredId}
              adminEndpointHost={adminEndpointHost}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * Diagnostic copy for the `sdk_installed` row. Returns:
 *   - `null` when the step has no diagnostic envelope (older deploys)
 *   - `{ tone: 'ok' }` when the SDK has been seen on this admin's backend
 *   - `{ tone: 'warn' }` when the SDK was seen, but on a DIFFERENT backend
 *   - `{ tone: 'info' }` when the step is incomplete and the SDK has never
 *     been seen anywhere — gives users an explicit "we are still waiting"
 *     state instead of letting an incomplete step look like a silent bug.
 *
 * Tone drives both color and copy so the single signal that matters most —
 * "is your SDK actually reaching this backend?" — is visible at a glance.
 */
function buildSdkDiagnostic(
  step: SetupStep,
  adminEndpointHost: string | null | undefined,
): { tone: 'ok' | 'warn' | 'info'; lines: string[] } | null {
  if (step.id !== 'sdk_installed' || !step.diagnostic) return null
  const { last_sdk_seen_at, last_sdk_origin, last_sdk_endpoint_host, last_sdk_user_agent } =
    step.diagnostic

  if (!last_sdk_seen_at) {
    if (step.complete) return null
    return {
      tone: 'info',
      lines: [
        'API key has never been used. After dropping the widget into your app, load any page once to register the SDK.',
      ],
    }
  }

  const seenAgo = formatRelativeTime(last_sdk_seen_at) ?? 'recently'
  const originLabel = last_sdk_origin ?? 'an unknown origin'
  const platformBits: string[] = []
  if (last_sdk_user_agent) {
    // Pull the first space-token (e.g. `Mozilla/5.0`) plus a hint at the
    // browser/runtime if we can spot one. Keeps the line scannable.
    const ua = last_sdk_user_agent
    const hint =
      /CapacitorWebView/i.test(ua) ? 'iOS / Capacitor'
      : /Mushi-Capacitor/i.test(ua) ? 'Capacitor SDK'
      : /Chrome\/(\d+)/.exec(ua)?.[0]
      ?? /Firefox\/(\d+)/.exec(ua)?.[0]
      ?? /Safari\/(\d+)/.exec(ua)?.[0]
      ?? null
    if (hint) platformBits.push(hint)
  }
  const platformSuffix = platformBits.length ? ` (${platformBits.join(', ')})` : ''

  // Mismatch detection: only warn when we have BOTH sides of the comparison.
  // Otherwise we'd false-positive on older deploys where the admin host
  // wasn't yet emitted.
  const haveBoth = Boolean(adminEndpointHost && last_sdk_endpoint_host)
  const hostsMatch = haveBoth && adminEndpointHost === last_sdk_endpoint_host

  if (haveBoth && !hostsMatch) {
    return {
      tone: 'warn',
      lines: [
        `SDK was last seen ${seenAgo} from ${originLabel}${platformSuffix}, but it is talking to ${last_sdk_endpoint_host}.`,
        `This admin reads from ${adminEndpointHost}. Point the SDK's NEXT_PUBLIC_MUSHI_API_ENDPOINT (or equivalent) at ${adminEndpointHost} so reports land here.`,
      ],
    }
  }

  return {
    tone: 'ok',
    lines: [`SDK was last seen ${seenAgo} from ${originLabel}${platformSuffix}.`],
  }
}

function SdkDiagnostic({ tone, lines }: { tone: 'ok' | 'warn' | 'info'; lines: string[] }) {
  const palette =
    tone === 'warn'
      ? 'border-warn/30 bg-warn/10 text-warn'
      : tone === 'ok'
        ? 'border-ok/30 bg-ok-muted/15 text-ok'
        : 'border-edge-subtle bg-surface-overlay/40 text-fg-secondary'
  const label = tone === 'warn' ? 'Backend mismatch' : tone === 'ok' ? 'SDK heartbeat' : 'Heartbeat'
  return (
    <div className={`mt-1.5 rounded-sm border px-2 py-1 text-3xs ${palette}`}>
      <span className="mr-1.5 font-semibold uppercase tracking-wider">{label}</span>
      {lines.map((line, i) => (
        <p key={i} className={i === 0 ? 'inline' : 'mt-0.5'}>
          {line}
        </p>
      ))}
    </div>
  )
}

function ChecklistRow({
  step,
  current,
  adminEndpointHost,
}: {
  step: SetupStep
  current?: boolean
  adminEndpointHost?: string | null
}) {
  const diag = buildSdkDiagnostic(step, adminEndpointHost)
  return (
    <li className={`flex items-start gap-2.5 rounded-sm px-1.5 py-1 motion-safe:transition-colors ${
      current ? 'bg-brand/5 ring-1 ring-brand/30' : 'hover:bg-surface-overlay/40'
    }`}>
      <StepIcon complete={step.complete} required={step.required} current={current} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs ${step.complete ? 'text-fg-secondary line-through' : 'text-fg'}`}>
            {step.label}
          </span>
          {current && (
            <span className="rounded-sm bg-brand/15 px-1 py-0.5 text-3xs text-brand uppercase tracking-wider">
              do this next
            </span>
          )}
          {!step.required && !current && (
            <span className="rounded-sm border border-edge-subtle bg-surface-raised px-1 py-0.5 text-3xs text-fg-faint uppercase tracking-wider">
              optional
            </span>
          )}
        </div>
        <p className="text-3xs text-fg-muted truncate">{step.description}</p>
        {diag && <SdkDiagnostic tone={diag.tone} lines={diag.lines} />}
      </div>
      {!step.complete && (
        <Link
          to={step.cta_to}
          className="shrink-0 text-2xs text-brand hover:text-brand-hover"
        >
          {step.cta_label} →
        </Link>
      )}
    </li>
  )
}

function ChecklistCard({
  step,
  current,
  adminEndpointHost,
}: {
  step: SetupStep
  current?: boolean
  adminEndpointHost?: string | null
}) {
  const diag = buildSdkDiagnostic(step, adminEndpointHost)
  return (
    <div className={`rounded-md border p-3 motion-safe:transition-all ${
      step.complete
        ? 'border-ok/30 bg-ok-muted/10'
        : current
          ? 'border-brand/40 bg-brand/5 ring-2 ring-brand/40'
          : step.required
            ? 'border-brand/30 bg-brand/5'
            : 'border-edge-subtle bg-surface-raised/30'
    }`}>
      <div className="flex items-start gap-3">
        <StepIcon complete={step.complete} required={step.required} current={current} large />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className={`text-sm font-medium ${step.complete ? 'text-fg-secondary' : 'text-fg'}`}>
              {step.label}
            </h4>
            {current && (
              <span className="rounded-sm bg-brand text-brand-fg px-1.5 py-0.5 text-3xs uppercase tracking-wider font-semibold">
                do this next
              </span>
            )}
            {!step.required && !current && (
              <span className="rounded-sm border border-edge-subtle bg-surface-raised px-1 py-0.5 text-3xs text-fg-faint uppercase tracking-wider">
                optional
              </span>
            )}
            {step.complete && (
              <span className="rounded-sm bg-ok/15 px-1.5 py-0.5 text-3xs text-ok uppercase tracking-wider">
                done
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-fg-muted">{step.description}</p>
          {diag && <SdkDiagnostic tone={diag.tone} lines={diag.lines} />}
        </div>
        {!step.complete && (
          <Link
            to={step.cta_to}
            className="shrink-0 inline-flex items-center gap-1 rounded-sm bg-brand px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand-hover motion-safe:transition-colors"
          >
            {step.cta_label}
          </Link>
        )}
      </div>
    </div>
  )
}

function StepIcon({
  complete,
  required,
  current,
  large,
}: { complete: boolean; required: boolean; current?: boolean; large?: boolean }) {
  const size = large ? 'h-5 w-5 text-xs' : 'h-4 w-4 text-2xs'
  if (complete) {
    return (
      <span className={`${size} mt-0.5 inline-flex items-center justify-center rounded-full bg-ok text-ok-fg shrink-0`}>
        ✓
      </span>
    )
  }
  if (current) {
    return (
      <span
        className={`${size} mt-0.5 inline-flex items-center justify-center rounded-full bg-brand text-brand-fg shrink-0 motion-safe:animate-pulse`}
        aria-label="Current step"
      >
        →
      </span>
    )
  }
  return (
    <span
      className={`${size} mt-0.5 inline-flex items-center justify-center rounded-full border ${required ? 'border-brand text-brand' : 'border-edge text-fg-faint'} shrink-0`}
    >
      ○
    </span>
  )
}
