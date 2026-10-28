/**
 * FILE: apps/admin/src/lib/ciAdvice.ts
 * PURPOSE: Shape the server's CI advice (`CiOverview.advice`) for "Speed it
 *          up" on /ci. The server writes one item per workflow or runner a
 *          rule fires on, so one rule on three workflows reads as three
 *          identical cards; this groups items of the same rule and title into
 *          one card that names every workflow or repo it applies to, shows
 *          the fix once, and keeps the worst severity. Pure, no React.
 */

import type { CiAdvice, CiCostAutofix } from './ciTypes'
import { repoShortName } from './ciView'

/** A workflow, repo, runner or machine one advice card applies to. */
interface CiAdviceTarget {
  key: string
  /** Short, for a chip: `ci-pr.yml`, `tsumagoi · ci-pr.yml`, `aw-tsumagoi`. */
  label: string
  /** Full, for the tooltip: `kensaurus/tsumagoi/.github/workflows/ci-pr.yml`. */
  title: string
}

export interface CiAdviceGroup {
  key: string
  /** The rule name before the first `:` in the advice id (`drafts_not_skipped`). */
  ruleId: string
  severity: CiAdvice['severity']
  title: string
  detail: string
  /** Distinct fixes, in order; one for every rule Mushi has today. */
  fixes: string[]
  targets: CiAdviceTarget[]
  /** One line per piece of evidence: each item's, split at `; `. */
  evidence: string[]
  /** How many advice items the card stands for. */
  count: number
  /** The places Mushi can fix with a draft PR ("Open fix PR"), one per workflow file. */
  fixable: CiAdviceFixable[]
}

/** One advice item Mushi can turn into a draft PR (POST /v1/admin/ci/cost-fixes). */
export interface CiAdviceFixable {
  key: string
  /** The target chip text: `ci-pr.yml`, or `tsumagoi · ci-pr.yml` across repos. */
  label: string
  autofix: CiCostAutofix
  evidence: string
  monthSavingUsd: number | null
}

const SEVERITY_RANK: Record<CiAdvice['severity'], number> = { high: 0, medium: 1, low: 2 }

/** `drafts_not_skipped:owner/repo:.github/workflows/ci.yml` → `drafts_not_skipped`. */
function adviceRuleId(id: string): string {
  return id.split(':')[0]
}

/**
 * Evidence the server joins with `; ` (the slowest steps, an infra share and
 * its worst runner) as separate lines.
 */
function splitEvidence(evidence: string): string[] {
  return evidence
    .split(/;\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** The workflow file an advice id names (`…:.github/workflows/ci-pr.yml`), if any. */
function workflowOf(a: CiAdvice): string | null {
  const last = a.id.split(':').slice(2).join(':')
  return /\.ya?ml$/i.test(last) ? last : null
}

function targetsOf(items: CiAdvice[]): CiAdviceTarget[] {
  const repos = new Set(items.map((a) => a.repo).filter(Boolean))
  const out = new Map<string, CiAdviceTarget>()
  for (const a of items) {
    const workflow = workflowOf(a)
    const repo = a.repo ?? null
    if (workflow) {
      const file = workflow.split('/').pop() ?? workflow
      const label = repo && repos.size > 1 ? `${repoShortName(repo)} · ${file}` : file
      out.set(`wf:${repo}:${workflow}`, { key: `wf:${repo}:${workflow}`, label, title: repo ? `${repo}/${workflow}` : workflow })
    } else if (a.runner) {
      out.set(`runner:${a.runner}`, { key: `runner:${a.runner}`, label: a.runner, title: repo ? `${a.runner} on ${repo}` : a.runner })
    } else if (repo) {
      out.set(`repo:${repo}`, { key: `repo:${repo}`, label: repoShortName(repo), title: repo })
    }
  }
  return [...out.values()]
}

function fixableOf(items: CiAdvice[]): CiAdviceFixable[] {
  const repos = new Set(items.map((a) => a.autofix?.repo).filter(Boolean))
  const out = new Map<string, CiAdviceFixable>()
  for (const a of items) {
    const fix = a.autofix
    if (!fix) continue
    const key = `${fix.projectId}:${fix.repo}:${fix.workflowPath}:${fix.kind}`
    if (out.has(key)) continue
    const file = fix.workflowPath.split('/').pop() ?? fix.workflowPath
    out.set(key, {
      key,
      label: repos.size > 1 ? `${repoShortName(fix.repo)} · ${file}` : file,
      autofix: fix,
      evidence: a.evidence,
      monthSavingUsd: a.monthSavingUsd ?? null,
    })
  }
  return [...out.values()]
}

/**
 * One card per rule and title: severity is the worst of the group, the
 * targets list every workflow / repo / runner it fired on, the evidence keeps
 * every line. Cards come worst first, then in the server's order.
 */
export function groupCiAdvice(advice: CiAdvice[]): CiAdviceGroup[] {
  const groups = new Map<string, CiAdvice[]>()
  for (const a of advice) {
    const key = `${adviceRuleId(a.id)}|${a.title}`
    const list = groups.get(key)
    if (list) list.push(a)
    else groups.set(key, [a])
  }
  const out: CiAdviceGroup[] = [...groups.entries()].map(([key, items]) => ({
    key,
    ruleId: adviceRuleId(items[0].id),
    severity: items.reduce<CiAdvice['severity']>((worst, a) => (SEVERITY_RANK[a.severity] < SEVERITY_RANK[worst] ? a.severity : worst), 'low'),
    title: items[0].title,
    detail: items[0].detail,
    fixes: [...new Set(items.map((a) => a.fix))],
    targets: targetsOf(items),
    evidence: [...new Set(items.flatMap((a) => splitEvidence(a.evidence)))],
    count: items.length,
    fixable: fixableOf(items),
  }))
  // Array.prototype.sort is stable: equal severities keep the server's order.
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
