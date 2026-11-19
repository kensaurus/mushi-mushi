/**
 * FILE: apps/admin/src/components/prompt-lab/promptRecommendation.ts
 * PURPOSE: AI prompts leads with ONE recommendation in plain words and the button that acts on it
 *          (console UX overhaul, 2026-11-19; the page used to say "v1-baseline-auto-20260621 ·
 *          49%", "Test at 50% of traffic", "Activate"). Steps are read with the same `stepTest`
 *          the scoreboard uses, and the most useful step wins:
 *
 *            1. switch  — a test has enough grades and grades higher (or the one in use has none)
 *            2. start   — a test exists but gets no reports
 *            3. grade   — a test runs but has too few grades to judge ("N more needed")
 *            4. behind  — a test grades lower than the one in use
 *
 *          The thresholds are the nightly auto-promotion's (_shared/prompt-ab.ts
 *          checkPromotionEligibility): 30 grades, and more than 5% better than the one in use (any
 *          positive grade when the one in use has none). The page only suggests what the nightly
 *          run would do anyway, a step sooner.
 */

import { stepTest } from './promptLabCounts'
import { STAGE_LABELS, type PromptVersion } from './types'
import { trafficWords } from './VersionStateMark'

export const MIN_GRADES_TO_SWITCH = 30
/** Relative lift over the one in use before a switch is suggested (MIN_SCORE_LIFT_PERCENT). */
export const MIN_LIFT_PCT = 5
/** The share a "Start" button gives a test that gets no reports. */
export const START_TEST_PCT = 50

export type PromptRecommendationAction =
  | { kind: 'switch'; version: PromptVersion }
  | { kind: 'start'; version: PromptVersion; pct: number }
  | { kind: 'grade' }
  | { kind: 'open'; stage: string }

export interface PromptRecommendation {
  stage: string | null
  sentence: string
  tone: 'ok' | 'warn' | 'info' | 'neutral'
  action: PromptRecommendationAction | null
  actionLabel: string | null
}

const pct = (s: number) => `${Math.round(s * 100)}%`

function stepName(stage: string): string {
  return STAGE_LABELS[stage] ?? stage
}

/** Only a project's own copy can be switched to or given reports (built-in ones are read-only). */
const editable = (p: PromptVersion) => p.project_id != null

export function promptRecommendation(prompts: readonly PromptVersion[]): PromptRecommendation {
  const byStage = new Map<string, PromptVersion[]>()
  for (const p of prompts) byStage.set(p.stage, [...(byStage.get(p.stage) ?? []), p])

  const found: Array<{ rank: number; rec: PromptRecommendation }> = []
  for (const [stage, versions] of byStage) {
    const { active, candidate, state } = stepTest(versions)
    if (!candidate || state === 'none') continue
    const name = stepName(stage)
    const a = active?.avg_judge_score ?? null
    const c = candidate.avg_judge_score
    const vs = a != null ? `${pct(a)} for the one in use` : 'no grade yet for the one in use'

    if (state === 'not_started') {
      found.push({
        rank: 2,
        rec: editable(candidate)
          ? {
              stage,
              sentence: `${name} has a test version that gets no reports, so it never gets graded. Start it on ${trafficWords(START_TEST_PCT)}.`,
              tone: 'warn',
              action: { kind: 'start', version: candidate, pct: START_TEST_PCT },
              actionLabel: `Start on ${trafficWords(START_TEST_PCT)}`,
            }
          : {
              stage,
              sentence: `${name} has a built-in test version that gets no reports. Clone it to test it.`,
              tone: 'warn',
              action: { kind: 'open', stage },
              actionLabel: 'Open step',
            },
      })
      continue
    }
    if (c == null) {
      found.push({
        rank: 3,
        rec: {
          stage,
          sentence: `A newer ${name} prompt runs on ${trafficWords(candidate.traffic_percentage)} and has no grades yet: ${MIN_GRADES_TO_SWITCH} needed.`,
          tone: 'info',
          action: { kind: 'grade' },
          actionLabel: 'Grade reports now',
        },
      })
      continue
    }
    const ahead = a == null || a <= 0 ? c > 0 : ((c - a) / a) * 100 > MIN_LIFT_PCT
    const more = Math.max(0, MIN_GRADES_TO_SWITCH - candidate.total_evaluations)
    if (ahead && more === 0 && editable(candidate)) {
      found.push({
        rank: 1,
        rec: { stage, sentence: `A newer ${name} prompt scores ${pct(c)} vs ${vs}. Switch to it.`, tone: 'ok', action: { kind: 'switch', version: candidate }, actionLabel: 'Switch to it' },
      })
    } else if (ahead && more > 0) {
      found.push({
        rank: 3,
        rec: {
          stage,
          sentence: `A newer ${name} prompt scores ${pct(c)} vs ${vs}. Not enough grades yet: ${more} more needed.`,
          tone: 'info',
          action: { kind: 'grade' },
          actionLabel: 'Grade reports now',
        },
      })
    } else if (!ahead) {
      const close = a != null && c > a
      found.push({
        rank: 4,
        rec: {
          stage,
          sentence: close
            ? `The ${name} test scores ${pct(c)} vs ${vs}: not clearly better yet (it needs more than ${MIN_LIFT_PCT}% better).`
            : `The ${name} test scores ${pct(c)} vs ${vs}: keep the one in use.`,
          tone: 'neutral',
          action: { kind: 'open', stage },
          actionLabel: 'Open step',
        },
      })
    } else {
      // Ahead with enough grades, but a built-in version: it can only be cloned.
      found.push({
        rank: 4,
        rec: { stage, sentence: `A built-in ${name} prompt scores ${pct(c)} vs ${vs}. Clone it to switch.`, tone: 'info', action: { kind: 'open', stage }, actionLabel: 'Open step' },
      })
    }
  }
  found.sort((x, y) => x.rank - y.rank)
  if (found[0]) return found[0].rec
  return { stage: null, sentence: 'Each step runs one prompt; nothing is being tested.', tone: 'neutral', action: null, actionLabel: null }
}
