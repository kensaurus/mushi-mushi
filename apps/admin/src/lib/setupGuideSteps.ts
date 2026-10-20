/**
 * FILE: apps/admin/src/lib/setupGuideSteps.ts
 * NOTE: the docked setup guide was removed on 2026-10-20 (console audit); this
 *       module keeps the step-order rule (`nextSetupStepId`) every "do this
 *       next" surface reads, plus two formatting helpers.
 * PURPOSE: Pure view-model for the docked <SetupGuide>. Turns the canonical
 *          `/v1/admin/setup` checklist (built server-side in
 *          activation-setup-builder.ts) plus the `/v1/admin/projects` snapshot
 *          into per-step state, evidence facts, and destinations.
 *
 *          No new checklist is invented here. Step ids, labels, descriptions,
 *          required flags and default CTAs all come from the backend; this
 *          module only adds three things the API doesn't carry:
 *
 *            1. `state` — done / next / blocked / available. Blocking is
 *               derived ONLY from the required chain the backend already
 *               models (key → SDK → first report). Optional steps are never
 *               marked blocked: the real gate for those is `preflight.checks`,
 *               which this surface does not fetch, and guessing at it would
 *               drift from the canonical source.
 *            2. `facts` — "what is already connected", read from fields the
 *               two endpoints return. A step with no sourceable metadata gets
 *               no facts rather than a placeholder.
 *            3. `to` / `ctaLabel` — a completed step points at the page where
 *               the evidence lives ("go look at the repo you linked"), an
 *               incomplete one keeps the backend's own CTA.
 */

import type { SetupProject } from './useSetupStatus'

const REQUIRED_PREREQUISITE: Record<string, string> = {
  sdk_installed: 'api_key_generated',
  first_report_received: 'api_key_generated',
}

/**
 * Where a *completed* step's evidence lives. The backend CTA answers "how do
 * I finish this"; once finished the useful click is "show me the thing that
 * satisfied it". Unknown ids fall through to the backend CTA so a new
 * server-side step still renders correctly.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return null
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}


export function nextSetupStepId(project: Pick<SetupProject, 'steps'> | null | undefined): string | null {
  if (!project) return null
  const completeById = new Map<string, boolean>(project.steps.map((s) => [s.id, s.complete]))
  return (
    project.steps.find((s) => {
      if (!s.required || s.complete) return false
      const prereq = REQUIRED_PREREQUISITE[s.id]
      return !prereq || completeById.get(prereq) === true
    })?.id ?? null
  )
}
