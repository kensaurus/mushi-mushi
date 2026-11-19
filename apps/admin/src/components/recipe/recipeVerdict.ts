/**
 * FILE: apps/admin/src/components/recipe/recipeVerdict.ts
 * PURPOSE: The one sentence, up to three numbers and the one next step that lead the App
 *          blueprint page (owner, 2026-11-19: "lead with a verdict and ONE action"). Before,
 *          the page opened on "Overall ▲ Error Risk checks" and a "NOT MET (4)" heading.
 *
 *          Risk checks lead over blueprint cards: a check that found something is a real
 *          problem, a blueprint card that needs a look is setup. Never green by default: no
 *          result yet reads as not checked. Pure: no React.
 */

import type { ReactNode } from 'react'
import type { PageStatusMetric, PageStatusTone } from '../ui/page-status'
import { radarOverall } from '../portfolio/portfolioView'

export const DEPENDENCY_RULE = 'known_vulnerable_dependency'

/** @internal Exported for tests only. */
export interface VerdictDetector {
  ruleId: string
  title: string
  state: string
  findings: ReadonlyArray<{ severity: string; fix?: string | null }>
}

type VerdictNext =
  | { kind: 'fix-holes' }
  | { kind: 'fix-check'; ruleId: string }
  | { kind: 'rerun' }
  | { kind: 'element'; key: string; label: string }
  | { kind: 'run' }
  | null

interface RecipeVerdict {
  tone: PageStatusTone
  sentence: string
  metrics: PageStatusMetric[]
  next: VerdictNext
}

const SERIOUS = new Set(['critical', 'error', 'high'])

function isSerious(d: VerdictDetector): boolean {
  return d.findings.some((f) => SERIOUS.has(f.severity.toLowerCase()))
}

/** Problems worst first: serious findings, other findings, then checks that could not finish. */
export function rankProblems<T extends VerdictDetector>(problems: readonly T[]): T[] {
  const rank = (d: T) => (d.state === 'finding' ? (isSerious(d) ? 0 : 1) : 2)
  return [...problems].sort((a, b) => rank(a) - rank(b))
}

/** @internal Exported for tests only. A check as a problem in a few words, for the lead sentence. */
export function problemPhrase(d: VerdictDetector, holes: number): string {
  if (d.state === 'error') return `${d.title.replace(/\.$/, '')} could not be checked`
  if (d.ruleId === DEPENDENCY_RULE && holes > 0) return `${holes} ${holes === 1 ? 'dependency has' : 'dependencies have'} known security holes`
  return `not met: ${d.title.replace(/\.$/, '')}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function recipeVerdict(input: {
  /** null while the risk checks are loading or could not be read. */
  detectors: readonly VerdictDetector[] | null
  /** Hole rows that ship to users (dev-only packages left out). */
  holes: number
  /** Blueprint cards that need a look, worst first. */
  behind: ReadonlyArray<{ key: string; label: string }>
  /** Drawn under the holes number (the page's severity bar). */
  holesVisual?: ReactNode
}): RecipeVerdict {
  const { detectors, holes, behind, holesVisual } = input
  const problems = rankProblems((detectors ?? []).filter((d) => d.state === 'finding' || d.state === 'error'))
  const found = problems.filter((d) => d.state === 'finding')
  const unfinished = problems.filter((d) => d.state === 'error')
  const ran = (detectors ?? []).filter((d) => d.state === 'ok' || d.state === 'finding' || d.state === 'error').length

  const metrics: PageStatusMetric[] = []
  if (found.length > 0) metrics.push({ label: found.length === 1 ? 'Risk check not met' : 'Risk checks not met', value: found.length, tone: radarOverall(found)?.tone ?? 'warn' })
  if (holes > 0) metrics.push({ label: holes === 1 ? 'Dependency with holes' : 'Dependencies with holes', value: holes, tone: 'danger', ...(holesVisual ? { visual: holesVisual } : {}) })
  if (behind.length > 0) metrics.push({ label: behind.length === 1 ? 'Blueprint part to check' : 'Blueprint parts to check', value: behind.length, tone: 'warn' })

  if (problems.length > 0) {
    const worst = problems[0]!
    const tone: PageStatusTone = found.length > 0 ? radarOverall(found)?.tone ?? 'warn' : 'warn'
    const more = problems.length - 1
    const sentence = `${plural(problems.length, 'risk check')} ${problems.length === 1 ? 'needs' : 'need'} you. Start here: ${problemPhrase(worst, holes)}${more > 0 ? ` (and ${more} more below)` : ''}.`
    const next: VerdictNext =
      worst.ruleId === DEPENDENCY_RULE && worst.state === 'finding' && holes > 0
        ? { kind: 'fix-holes' }
        : worst.state === 'finding' && worst.findings.some((f) => f.fix)
          ? { kind: 'fix-check', ruleId: worst.ruleId }
          : unfinished.length === problems.length
            ? { kind: 'rerun' }
            : holes > 0
              ? { kind: 'fix-holes' }
              : { kind: 'fix-check', ruleId: worst.ruleId }
    return { tone, sentence, metrics, next }
  }
  if (behind.length > 0) {
    const first = behind[0]!
    return {
      tone: 'warn',
      sentence: `${detectors == null || ran === 0 ? 'No risk check has a result yet, and ' : 'No risk check found a problem, but '}${behind.map((e) => e.label).join(', ')} ${behind.length === 1 ? 'needs' : 'need'} a look.`,
      metrics,
      next: { kind: 'element', key: first.key, label: first.label },
    }
  }
  if (detectors == null || ran === 0) {
    return { tone: 'neutral', sentence: 'No risk check has a result yet. Run them to see what could break without throwing an error.', metrics, next: { kind: 'run' } }
  }
  return { tone: 'ok', sentence: 'Nothing needs you: every risk check that ran passed, and the blueprint has no open problem.', metrics, next: null }
}
