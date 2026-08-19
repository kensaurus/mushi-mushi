/**
 * FILE: apps/admin/src/lib/setupGuideSteps.ts
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

import type { SetupProject, SetupStep } from './useSetupStatus'
import type { ProjectSnapshot } from './projectSnapshotTypes'

export type SetupGuideStepState = 'done' | 'next' | 'blocked' | 'available'

export type SetupGuideFactTone = 'ok' | 'warn' | 'muted'

export interface SetupGuideFact {
  label: string
  value: string
  tone: SetupGuideFactTone
}

export interface SetupGuideStep {
  id: string
  label: string
  description: string
  required: boolean
  state: SetupGuideStepState
  /** Short text shown beside the state icon — never colour alone. */
  stateLabel: string
  /** Label of the step that has to land first, when `state === 'blocked'`. */
  blockedBy: string | null
  to: string
  ctaLabel: string
  facts: SetupGuideFact[]
}

export interface SetupGuideModel {
  hasProject: boolean
  projectName: string | null
  requiredComplete: number
  requiredTotal: number
  optionalComplete: number
  optionalTotal: number
  /** Required-step completion, 0–100. Drives the meter and the pill. */
  percent: number
  allRequiredDone: boolean
  steps: SetupGuideStep[]
  /** Id of the one step the user should do now, or null when required work is done. */
  nextStepId: string | null
  /** Set when the SDK heartbeat reached a different backend than this console. */
  hostMismatch: { sdkHost: string; adminHost: string } | null
}

/**
 * The required chain the backend models: you cannot install the SDK without a
 * key, and a report cannot arrive before the SDK is running. Nothing else is
 * asserted — see the module header.
 */
const REQUIRED_PREREQUISITE: Record<string, string> = {
  sdk_installed: 'api_key_generated',
  first_report_received: 'sdk_installed',
}

/**
 * Where a *completed* step's evidence lives. The backend CTA answers "how do
 * I finish this"; once finished the useful click is "show me the thing that
 * satisfied it". Unknown ids fall through to the backend CTA so a new
 * server-side step still renders correctly.
 */
const DONE_DESTINATION: Record<string, { to: string; label: string }> = {
  project_created: { to: '/projects', label: 'View project' },
  api_key_generated: { to: '/projects', label: 'View API keys' },
  sdk_installed: { to: '/connect', label: 'View SDK status' },
  first_report_received: { to: '/reports', label: 'View reports' },
  github_connected: { to: '/integrations/config', label: 'View repo link' },
  sentry_connected: { to: '/integrations/config', label: 'View Sentry link' },
  byok_anthropic: { to: '/settings', label: 'View key settings' },
  first_fix_dispatched: { to: '/fixes', label: 'View fixes' },
  slack_connected: { to: '/integrations/config', label: 'View Slack link' },
  first_qa_story_passing: { to: '/qa-coverage', label: 'View QA stories' },
}

/** Compact relative time. Returns null on missing/garbage input. */
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

/** `https://github.com/acme/web` → `acme/web`. Null when there's no url. */
export function repoSlug(url: string | null | undefined): string | null {
  if (!url) return null
  const cleaned = url
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
  if (!cleaned) return null
  try {
    const parts = new URL(cleaned).pathname.split('/').filter(Boolean)
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
    return parts[parts.length - 1] ?? null
  } catch {
    const trimmed = cleaned.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\/$/, '')
    return trimmed.split('?')[0] || null
  }
}

function fact(label: string, value: string | null, tone: SetupGuideFactTone): SetupGuideFact | null {
  if (!value) return null
  return { label, value, tone }
}

function compact(facts: Array<SetupGuideFact | null>): SetupGuideFact[] {
  return facts.filter((f): f is SetupGuideFact => f != null)
}

interface FactContext {
  project: SetupProject
  snapshot: ProjectSnapshot | null
  adminEndpointHost: string | null
  now: number
}

/**
 * Evidence for a completed step. Only fields the two endpoints actually
 * return are used — steps whose metadata lives behind an endpoint this
 * surface does not call (Slack channel, Sentry org, BYOK key hint) return
 * an empty list and render as state + deep link only.
 */
function factsForStep(step: SetupStep, ctx: FactContext): SetupGuideFact[] {
  if (!step.complete) return []
  const { project, snapshot, adminEndpointHost, now } = ctx

  switch (step.id) {
    case 'project_created':
      return compact([
        fact('Project', project.project_name, 'ok'),
        fact('Created', relativeTime(project.created_at, now), 'muted'),
      ])

    case 'api_key_generated': {
      const keys = (snapshot?.api_keys ?? []).filter((k) => k.is_active !== false && !k.revoked)
      const lastSeen = keys
        .map((k) => k.last_seen_at ?? null)
        .filter((v): v is string => Boolean(v))
        .sort()
        .pop()
      return compact([
        keys.length > 0 ? fact('Active keys', String(keys.length), 'ok') : null,
        fact('Last used', relativeTime(lastSeen, now) ?? (keys.length ? 'Not used yet' : null), lastSeen ? 'ok' : 'warn'),
      ])
    }

    case 'sdk_installed': {
      const d = step.diagnostic
      const mismatch = Boolean(
        adminEndpointHost && d?.last_sdk_endpoint_host && d.last_sdk_endpoint_host !== adminEndpointHost,
      )
      return compact([
        fact('Version', snapshot?.sdk_version ? `v${snapshot.sdk_version.replace(/^v/i, '')}` : null, 'ok'),
        fact('Last heartbeat', relativeTime(d?.last_sdk_seen_at, now), 'ok'),
        fact('Origin', d?.last_sdk_origin ?? null, 'muted'),
        fact('Backend', d?.last_sdk_endpoint_host ?? null, mismatch ? 'warn' : 'muted'),
      ])
    }

    case 'first_report_received':
      return compact([
        fact('Reports', String(project.report_count), 'ok'),
        fact('Latest', relativeTime(snapshot?.last_report_at, now), 'muted'),
      ])

    case 'github_connected':
      return compact([
        fact('Repository', repoSlug(snapshot?.primary_repo?.repo_url) ?? 'Linked', 'ok'),
        fact('Default branch', snapshot?.primary_repo?.default_branch ?? null, 'muted'),
        project.indexed_file_count
          ? fact('Files indexed', String(project.indexed_file_count), 'ok')
          : null,
      ])

    case 'first_fix_dispatched':
      return compact([
        fact('Dispatched', String(project.fix_count), 'ok'),
        fact('Merged', String(project.merged_fix_count), project.merged_fix_count > 0 ? 'ok' : 'muted'),
      ])

    default:
      // sentry_connected / byok_anthropic / slack_connected /
      // first_qa_story_passing: the values live in project_settings and are
      // not returned by /v1/admin/setup or /v1/admin/projects. Showing the
      // state honestly beats inventing a field.
      return []
  }
}

function destinationFor(step: SetupStep): { to: string; label: string } {
  if (!step.complete) return { to: step.cta_to, label: step.cta_label }
  return DONE_DESTINATION[step.id] ?? { to: step.cta_to, label: step.cta_label }
}

const EMPTY_MODEL: SetupGuideModel = {
  hasProject: false,
  projectName: null,
  requiredComplete: 0,
  requiredTotal: 0,
  optionalComplete: 0,
  optionalTotal: 0,
  percent: 0,
  allRequiredDone: false,
  steps: [],
  nextStepId: null,
  hostMismatch: null,
}

/**
 * The pre-project state. `/v1/admin/setup` returns `projects: []` before the
 * first project exists, so there is no server-built checklist to map — the
 * guide shows the one step that unlocks all the others.
 */
export const NO_PROJECT_MODEL: SetupGuideModel = {
  ...EMPTY_MODEL,
  requiredTotal: 1,
  steps: [
    {
      id: 'project_created',
      label: 'Create your first project',
      description: 'A project groups all bug reports from one application.',
      required: true,
      state: 'next',
      stateLabel: 'Do this next',
      blockedBy: null,
      to: '/projects',
      ctaLabel: 'Create project',
      facts: [],
    },
  ],
  nextStepId: 'project_created',
}

export function buildSetupGuideModel(
  project: SetupProject | null,
  options: {
    snapshot?: ProjectSnapshot | null
    adminEndpointHost?: string | null
    hasAnyProject?: boolean
    now?: number
  } = {},
): SetupGuideModel {
  if (!project) return options.hasAnyProject === false ? NO_PROJECT_MODEL : EMPTY_MODEL

  const snapshot = options.snapshot ?? null
  const adminEndpointHost = options.adminEndpointHost ?? null
  const now = options.now ?? Date.now()
  const ctx: FactContext = { project, snapshot, adminEndpointHost, now }

  // Keyed by plain string: SetupStepIdSchema is `z.string()` so a step id the
  // union doesn't know about is a valid runtime value, not a bug.
  const completeById = new Map<string, boolean>(project.steps.map((s) => [s.id, s.complete]))
  const labelById = new Map<string, string>(project.steps.map((s) => [s.id, s.label]))

  /** First incomplete required step whose prerequisite chain is satisfied. */
  const nextStepId =
    project.steps.find((s) => {
      if (!s.required || s.complete) return false
      const prereq = REQUIRED_PREREQUISITE[s.id]
      return !prereq || completeById.get(prereq) === true
    })?.id ?? null

  const steps: SetupGuideStep[] = project.steps.map((step) => {
    const prereq = REQUIRED_PREREQUISITE[step.id]
    const blocked =
      !step.complete && step.required && Boolean(prereq) && completeById.get(prereq) !== true
    const state: SetupGuideStepState = step.complete
      ? 'done'
      : blocked
        ? 'blocked'
        : step.id === nextStepId
          ? 'next'
          : 'available'
    const blockedBy = blocked ? labelById.get(prereq) ?? prereq : null
    const destination = destinationFor(step)

    return {
      id: step.id,
      label: step.label,
      description: step.description,
      required: step.required,
      state,
      stateLabel: stateLabelFor(state, step.required, blockedBy),
      blockedBy,
      to: destination.to,
      ctaLabel: destination.label,
      facts: factsForStep(step, ctx),
    }
  })

  const optionalSteps = project.steps.filter((s) => !s.required)
  const sdkStep = project.steps.find((s) => s.id === 'sdk_installed')
  const sdkHost = sdkStep?.diagnostic?.last_sdk_endpoint_host ?? null
  const hostMismatch =
    sdkStep?.complete && adminEndpointHost && sdkHost && sdkHost !== adminEndpointHost
      ? { sdkHost, adminHost: adminEndpointHost }
      : null

  return {
    hasProject: true,
    projectName: project.project_name,
    requiredComplete: project.required_complete,
    requiredTotal: project.required_total,
    optionalComplete: optionalSteps.filter((s) => s.complete).length,
    optionalTotal: optionalSteps.length,
    percent: Math.round((project.required_complete / Math.max(1, project.required_total)) * 100),
    allRequiredDone: project.done,
    steps,
    nextStepId,
    hostMismatch,
  }
}

export function stateLabelFor(
  state: SetupGuideStepState,
  required: boolean,
  blockedBy: string | null,
): string {
  switch (state) {
    case 'done':
      return 'Done'
    case 'next':
      return 'Do this next'
    case 'blocked':
      return blockedBy ? `Waiting on "${blockedBy}"` : 'Waiting on an earlier step'
    case 'available':
      return required ? 'Ready' : 'Optional'
  }
}

/** One-line summary for the docked pill and its accessible name. */
export function setupGuideSummary(model: SetupGuideModel): string {
  if (!model.hasProject && model.steps.length === 0) return 'Setup guide'
  if (model.allRequiredDone) {
    return model.optionalTotal > 0
      ? `Setup done · ${model.optionalComplete}/${model.optionalTotal} extras`
      : 'Setup done'
  }
  return `Setup ${model.requiredComplete}/${model.requiredTotal}`
}
