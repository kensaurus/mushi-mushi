/**
 * FILE: apps/admin/src/lib/pdca.ts
 * PURPOSE: Single source of truth for PDCA stage metadata used across the
 *          admin: cockpit tiles, sidebar groups, page-header context chips,
 *          hero intro, onboarding narrative.
 *
 *          One file means: rename a stage in the README and every surface
 *          updates with it; tone tokens drift in lock-step; the reverse map
 *          (route → stage) lives next to the forward one so a new page just
 *          adds itself to STAGE_ROUTES and inherits the chip + hint.
 */

export type PdcaStageId = 'plan' | 'do' | 'check' | 'act'

export interface PdcaStageMeta {
  id: PdcaStageId
  letter: 'P' | 'D' | 'C' | 'A'
  label: string
  /** One-sentence hint shown in tooltips + on the chip's expanded form. */
  hint: string
  /** Tailwind tokens for the small letter-badge. */
  badgeBg: string
  badgeFg: string
  /** Tailwind tokens for tinted backgrounds and rings. */
  tintBg: string
  tintBorder: string
  ring: string
  text: string
}

export const PDCA_STAGES: Record<PdcaStageId, PdcaStageMeta> = {
  plan: {
    id: 'plan',
    letter: 'P',
    label: 'Plan',
    hint: 'Capture user-felt bugs, classify them, dedupe by fingerprint, and prioritise by blast radius.',
    badgeBg: 'bg-info-muted',
    badgeFg: 'text-info',
    tintBg: 'bg-info-muted/15',
    tintBorder: 'border-info/30',
    ring: 'ring-info/50',
    text: 'text-info',
  },
  do: {
    id: 'do',
    letter: 'D',
    label: 'Do',
    hint: 'Dispatch the auto-fix agent: turn a classified report into a draft pull request on a feature branch.',
    badgeBg: 'bg-brand/15',
    badgeFg: 'text-brand',
    tintBg: 'bg-brand/10',
    tintBorder: 'border-brand/30',
    ring: 'ring-brand/60',
    text: 'text-brand',
  },
  check: {
    id: 'check',
    letter: 'C',
    label: 'Check',
    hint: 'Independently grade the LLM\u2019s work and the system\u2019s own health \u2014 judge scores, traces, eval drift.',
    badgeBg: 'bg-warn-muted',
    badgeFg: 'text-warn',
    tintBg: 'bg-warn/10',
    tintBorder: 'border-warn/30',
    ring: 'ring-warn/50',
    text: 'text-warn',
  },
  act: {
    id: 'act',
    letter: 'A',
    label: 'Act',
    hint: 'Standardise verified fixes back into the upstream tools your team already lives in (PR merge, ChatOps, Slack).',
    badgeBg: 'bg-ok-muted',
    badgeFg: 'text-ok',
    tintBg: 'bg-ok-muted/15',
    tintBorder: 'border-ok/30',
    ring: 'ring-ok/50',
    text: 'text-ok',
  },
}

export const PDCA_ORDER: PdcaStageId[] = ['plan', 'do', 'check', 'act']

/**
 * Reverse-map admin routes to a PDCA stage. New pages just add their path
 * here and inherit the context chip + sidebar grouping for free. Routes are
 * matched as prefixes (so `/reports/abc123` resolves to `plan`).
 */
const STAGE_ROUTES: Array<{ prefix: string; stage: PdcaStageId }> = [
  { prefix: '/reports',       stage: 'plan' },
  { prefix: '/graph',         stage: 'plan' },
  { prefix: '/anti-gaming',   stage: 'plan' },
  { prefix: '/queue',         stage: 'plan' },
  { prefix: '/fixes',         stage: 'do' },
  { prefix: '/prompt-lab',    stage: 'do' },
  { prefix: '/judge',         stage: 'check' },
  { prefix: '/health',        stage: 'check' },
  { prefix: '/intelligence',  stage: 'check' },
  { prefix: '/research',      stage: 'check' },
  { prefix: '/integrations',  stage: 'act' },
  { prefix: '/marketplace',   stage: 'act' },
  { prefix: '/notifications', stage: 'act' },
]

export function stageForPath(pathname: string): PdcaStageId | null {
  const hit = STAGE_ROUTES.find(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  return hit?.stage ?? null
}

export function nextStage(stage: PdcaStageId): PdcaStageId | null {
  const i = PDCA_ORDER.indexOf(stage)
  return i >= 0 && i < PDCA_ORDER.length - 1 ? PDCA_ORDER[i + 1] : null
}
