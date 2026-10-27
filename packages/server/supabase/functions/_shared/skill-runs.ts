/**
 * FILE: packages/server/supabase/functions/_shared/skill-runs.ts
 * PURPOSE: Skill runs (ADR 0042): apply one skill from the synced catalog
 *          (agent_skills, kensaurus/skills) to one scope of one app, round
 *          after round, through the same loop as a bug fix.
 *
 *          Each round is a report (source 'skill_run', filed classified) that
 *          spend-down dispatches on the app's own pooled Cursor key; its PR
 *          gets the Opus review (ADR 0030), review follow-ups (ADR 0032) and
 *          the merge queue (ADR 0041). The next round is filed after a merge;
 *          the run ends when the agent finds nothing left in scope.
 *
 *          Only skills whose result an agent can measure and that need no
 *          product decision are offered: each names what to measure before
 *          and after, so the PR carries numbers and Opus can check them.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export interface SkillRunSkill {
  slug: string
  /** What the console shows. */
  label: string
  /** What the agent measures before and after; goes into the task and the PR. */
  measure: string
}

export const SKILL_RUN_SKILLS: readonly SkillRunSkill[] = [
  { slug: 'audit-accessibility', label: 'Accessibility (WCAG 2.2 AA)', measure: 'axe-core violations on each page in scope, run in a headless browser at 360 and 1280 px wide' },
  { slug: 'audit-responsive', label: 'Layouts at every width', measure: 'horizontal scroll, clipped or overlapping text and tap targets under 24 px at 360, 768 and 1440 px wide on each page in scope' },
  { slug: 'audit-ui-states', label: 'Loading, empty and error states', measure: 'which lists, forms and data views in scope lack a loading, empty, error or offline state (count before and after)' },
  { slug: 'enhance-web-ux', label: 'Page UX (NN/g heuristics)', measure: 'the heuristic problems the skill lists on each page in scope (count before and after, with a screenshot of each page)' },
  { slug: 'enhance-readability', label: 'Readability', measure: 'line length in characters, reading level and dense blocks on each page in scope' },
  { slug: 'enhance-web-forms', label: 'Forms', measure: 'fields without a label, without inline validation or with errors a screen reader cannot hear, per form in scope' },
  { slug: 'enhance-mobile-native-feel', label: 'Native feel (Capacitor, Expo)', measure: 'safe-area overlaps, tap targets under 44 px, missing haptics or back behaviour on the screens in scope' },
  { slug: 'housekeep-design', label: 'One design system', measure: 'hard-coded colours, font sizes and spacing, and duplicate variants of the same component, in scope' },
  { slug: 'audit-i18n', label: 'Translations', measure: 'hard-coded user-facing strings and keys missing per locale, in scope' },
  { slug: 'enhance-web-seo', label: 'SEO metadata', measure: 'pages in scope missing a title, description, canonical, Open Graph image or structured data' },
  { slug: 'audit-performance', label: 'Runtime performance', measure: 'Lighthouse performance score, LCP, INP and CLS of the pages in scope (mobile profile)' },
  { slug: 'audit-bundle-size', label: 'Bundle size', measure: 'the production JavaScript size of the app and of the routes in scope, from the build output' },
  { slug: 'backend-error-handling', label: 'Error handling', measure: 'errors in scope that are swallowed or never read (for example a supabase-js `{ error }` ignored), count before and after' },
  { slug: 'housekeep-dead-code', label: 'Dead code', measure: 'unused files, exports and dependencies in scope as Knip reports them' },
  // Inventory only (the skill implements nothing); dependency bumps stay on the ADR 0019 / 0038 paths.
  { slug: 'housekeep-backlog', label: 'Parked-work register', measure: 'docs/BACKLOG.md rows by status (open, verify-done, stale, closed) and the diff against the last regeneration: rows added, closed and newly stale, each with its source file' },
  { slug: 'test-unit', label: 'Unit tests', measure: 'tests and line coverage of the modules in scope' },
] as const

export const SKILL_RUN_MAX_ROUNDS = 5
export const SKILL_RUN_MAX_ACTIVE_PER_APP = 5
/** Characters of SKILL.md copied into a round's task; the agent can read the rest from the catalog link. */
export const SKILL_TEXT_CAP = 12_000

export function skillRunSkill(slug: string): SkillRunSkill | null {
  return SKILL_RUN_SKILLS.find((s) => s.slug === slug) ?? null
}

export interface RoundHistory {
  round: number
  reportId: string
  outcome: string
  prUrl?: string | null
}

/** The report a round files: the task, the measurement, and the skill's own text. */
export function skillRunReport(args: {
  skill: SkillRunSkill
  skillTitle: string | null
  skillBody: string | null
  skillUrl: string | null
  scope: string
  appName: string
  round: number
  roundsMax: number
  history: RoundHistory[]
}): { summary: string; description: string; component: string } {
  const { skill, scope, round, roundsMax } = args
  const merged = args.history.filter((h) => h.prUrl && h.outcome === 'merged')
  const body = (args.skillBody ?? '').trim()
  const cut = body.length > SKILL_TEXT_CAP ? `${body.slice(0, SKILL_TEXT_CAP)}\n\n[… the rest of the skill: ${args.skillUrl ?? 'see the skills catalog'}]` : body
  const description = [
    `Skill run: ${skill.label} (${skill.slug}), round ${round} of ${roundsMax}, on ${args.appName}.`,
    'This is planned improvement work a person asked for, not a bug a user reported.',
    '',
    `Scope: ${scope}`,
    '',
    'Task:',
    '1. Read the skill below and apply it to the scope only. Stay inside the scope.',
    `2. Measure first: ${skill.measure}. Put the numbers before and after in the pull request description.`,
    '3. Make the changes the skill calls for in this scope as one coherent pull request (about 10 files or fewer). Keep behaviour the same unless the skill says otherwise, add or update tests where behaviour changes, and never weaken a test, a lint rule or a type check.',
    '4. If nothing in the scope needs changing, open no pull request and start your final message with `Mushi verdict: already_fixed`. If a change needs a product decision (copy, pricing, a flow), make the rest and say which decision is open; if all of it needs one, `Mushi verdict: needs_human`.',
    ...(merged.length
      ? ['', `Earlier rounds already merged: ${merged.map((h) => `round ${h.round} ${h.prUrl}`).join(', ')}. Build on them; do not redo or revert them.`]
      : []),
    '',
    `--- Skill: ${args.skillTitle ?? skill.slug} (${skill.slug})${args.skillUrl ? `, ${args.skillUrl}` : ''} ---`,
    cut || '(The skill text is not in the catalog yet; apply the skill by its name and the measurement above.)',
  ].join('\n')
  return {
    summary: `Skill run ${round}/${roundsMax}: ${skill.label} on ${scope}`.slice(0, 200),
    description,
    component: scope.slice(0, 120),
  }
}

export interface RoundState {
  /** reports.status of the current round's report; null when none was filed yet. */
  reportStatus: string | null
  /** The newest fix attempt for that report. */
  attempt: { status: string | null; failureCategory: string | null; prState: string | null; merged: boolean; prUrl: string | null } | null
  /** The latest completed Opus verdict on the attempt's PR (ADR 0030). */
  reviewVerdict?: string | null
  /** The PR is already in the merge queue (any state). */
  queued?: boolean
}

export type SkillRunStep =
  | { do: 'file' }
  | { do: 'wait' }
  | { do: 'queue' }
  | { do: 'done'; reason: string; outcome: string }
  | { do: 'stop'; reason: string; outcome: string }

const NOTHING_LEFT = new Set(['already_fixed', 'not_actionable'])

/** What a run does now, from its current round's report and fix attempt. */
export function nextSkillRunStep(run: { round: number; roundsMax: number; autoMerge?: boolean }, s: RoundState): SkillRunStep {
  if (s.reportStatus == null) return { do: 'file' }
  const a = s.attempt
  const status = (s.reportStatus ?? '').toLowerCase()
  if (a?.merged || status === 'fixed' || status === 'verified') {
    return run.round < run.roundsMax
      ? { do: 'file' }
      : { do: 'done', reason: `All ${run.roundsMax} rounds merged.`, outcome: 'merged' }
  }
  if (status === 'dismissed') return { do: 'stop', reason: 'The round was dismissed.', outcome: 'dismissed' }
  const failed = (a?.status ?? '').toLowerCase() === 'failed'
  const cat = (a?.failureCategory ?? '').toLowerCase()
  if (failed && NOTHING_LEFT.has(cat)) {
    return { do: 'done', reason: 'The agent found nothing left to change in scope.', outcome: cat }
  }
  if (failed && cat === 'needs_human') return { do: 'stop', reason: 'The agent says the rest needs a person to decide.', outcome: cat }
  if (failed && cat === 'wrong_repo') return { do: 'stop', reason: 'The agent says this scope is in another repository.', outcome: cat }
  if (a?.prState === 'closed' && !a.merged) return { do: 'stop', reason: 'The pull request was closed without merging.', outcome: 'closed' }
  // Opus approved the round's PR: hand it to the merge queue, whose own gates
  // (a merge verdict on the exact head, CI green, never past a hold) decide.
  if (run.autoMerge && a?.prUrl && !s.queued && (s.reviewVerdict ?? '') === 'merge') return { do: 'queue' }
  return { do: 'wait' }
}
