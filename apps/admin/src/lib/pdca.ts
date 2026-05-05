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

/** Synthetic chip identity used by the dashboard ("Overview — your loop at a
 *  glance"). It isn't a real PDCA stage — it sits *above* the loop so the
 *  page-header chip slot is never empty on `/`. */
export type PdcaChipId = PdcaStageId | 'overview'

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

/** Common rendering shape shared by `PdcaStageMeta` and the synthetic
 *  overview chip. Aliased off `PdcaStageMeta` so adding a new tint field
 *  only happens in one place. `letter` is widened to `string` because the
 *  overview chip uses `∞`, not a P/D/C/A letter. `ring` is omitted because
 *  the overview chip never receives a focus ring (it isn't selectable). */
type PdcaChipMeta = Omit<PdcaStageMeta, 'id' | 'letter' | 'ring'> & { letter: string }

/** Decorative chip metadata for the synthetic 'overview' surface. */
export const PDCA_OVERVIEW_CHIP: PdcaChipMeta = {
  letter: '∞',
  label: 'Overview — your loop at a glance',
  hint: 'A bird\u2019s-eye view of every PDCA stage. Drill into a tile to act.',
  badgeBg: 'bg-brand/15',
  badgeFg: 'text-brand',
  tintBg: 'bg-brand/5',
  tintBorder: 'border-brand/30',
  text: 'text-brand',
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
 * Plain-language outcomes per stage — used by the unified 4-stage first-run
 * loop card, the live pipeline diagram, and the Next-Best-Action strip.
 * Beginner copy is intentionally outcome-first (what does the user *get*?),
 * not capability-first (what does the system *do*?).
 *
 * Adding a new beginner-facing surface? Read from this map instead of
 * coining a new sentence — drift between PdcaCockpit, GettingStartedEmpty,
 * LivePdcaPipeline, and NextBestAction is a recurring audit finding.
 */
export const PDCA_STAGE_OUTCOMES: Record<PdcaStageId, {
  /** Verb-led headline ("Capture your first user-felt bug"). */
  headline: string
  /** One sentence explaining what *the user gets* from this stage. */
  outcome: string
  /** Sticker text for the LivePdcaPipeline node ("Capture", "Auto-fix"…). */
  pipelineLabel: string
}> = {
  plan: {
    headline: 'Capture user-felt bugs',
    outcome: 'Your end-users flag what hurts. Mushi groups, scores, and sorts the noise.',
    pipelineLabel: 'Capture',
  },
  do: {
    headline: 'Auto-draft a fix PR',
    outcome: 'Mushi opens a draft pull request with a one-paragraph rationale. You review the diff, not the ticket.',
    pipelineLabel: 'Auto-fix',
  },
  check: {
    headline: 'Verify the fix is real',
    outcome: 'An independent LLM judge + screenshot diff grade the change. Bad fixes never reach you.',
    pipelineLabel: 'Verify',
  },
  act: {
    headline: 'Ship and notify your stack',
    outcome: 'Merged fixes flow back to Sentry, Slack, and your CI — the loop closes itself.',
    pipelineLabel: 'Ship',
  },
}

/**
 * Reverse-map admin routes to a PDCA stage. New pages just add their path
 * here and inherit the context chip + sidebar grouping for free. Routes are
 * matched as prefixes (so `/reports/abc123` resolves to `plan`).
 *
 * IMPORTANT: only routes that live inside a PDCA stage in the sidebar
 * (`Layout.tsx > NAV`) belong here. Workspace routes (`/projects`,
 * `/settings`, `/sso`, `/billing`, `/audit`, `/compliance`, `/storage`,
 * `/query`) are deliberately outside the bug-fix loop and MUST be omitted
 * — adding one would (a) light up a false "← here" badge on the wrong
 * sidebar section, (b) render a false stage chip on its `PageHeader` via
 * `AutoPdcaChip`, and (c) mislabel `<PdcaContextHint />` in auto-mode.
 * Three surfaces, one source of truth — keep this list lock-step with the
 * stage-bearing sections in the sidebar.
 */
const STAGE_ROUTES: Array<{ prefix: string; stage: PdcaStageId }> = [
  { prefix: '/reports',       stage: 'plan' },
  { prefix: '/inventory',     stage: 'plan' },
  { prefix: '/graph',         stage: 'plan' },
  { prefix: '/anti-gaming',   stage: 'plan' },
  { prefix: '/queue',         stage: 'plan' },
  { prefix: '/fixes',         stage: 'do' },
  { prefix: '/repo',           stage: 'do' },
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

/** Returns the chip identity to render in the page-header chip slot.
 *  Pages under a real stage prefix get that stage; the dashboard gets
 *  the synthetic 'overview' chip; everything else returns null so the chip
 *  is suppressed (login, settings, billing — none of which sit in the loop).
 */
export function chipForPath(pathname: string): PdcaChipId | null {
  if (pathname === '/dashboard' || pathname === '') return 'overview'
  return stageForPath(pathname)
}

export function nextStage(stage: PdcaStageId): PdcaStageId | null {
  const i = PDCA_ORDER.indexOf(stage)
  return i >= 0 && i < PDCA_ORDER.length - 1 ? PDCA_ORDER[i + 1] : null
}
