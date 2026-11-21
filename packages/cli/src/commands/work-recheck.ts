/**
 * FILE: packages/cli/src/commands/work-recheck.ts
 * PURPOSE: Spend no agent run on a report that is already gone.
 *
 *          2026-11-12: of 10 drain runs, 3 found nothing to fix (two audit
 *          findings the code no longer had, one fix that main already
 *          carried). Each was a full agent run on the owner's plan. Two free
 *          checks run before the agent does:
 *
 *          1. A code-audit finding carries the deterministic check that filed
 *             it (ADR 0050: `/regex/ is present|absent in <file> near line N`,
 *             checkSummary in worker/audit.ts). Run it again on the fresh
 *             worktree with the audit's own evaluator: if it no longer
 *             reproduces, the report is closed, no install, no agent.
 *          2. An agent that answers `already_fixed` and names a commit: when
 *             that commit is on the base branch, the report is closed instead
 *             of waiting out a cooldown to be tried again.
 *
 *          Only a report whose `source` is `code_audit` is rechecked: a user's
 *          own words never decide that a report is fixed. Anything unclear (a
 *          check cut short, an unsafe pattern, a file that moved) leaves the
 *          report to the agent.
 */

import { join } from 'node:path'
import { patternReproduces, readWorktreeFile, safePath, safeRegex } from '../worker/audit.js'
import { absentHeldByWrapper, auditCategory, auditPatternKey, patternRoot } from '../worker/audit-patterns.js'

/** checkSummary cuts its text at 300 characters; a check that long may have lost its end. */
const SUMMARY_CAP = 300

interface ParsedAuditCheck {
  kind: 'pattern'
  regex: string
  ignoreCase: boolean
  expect: 'present' | 'absent'
  file: string
  line: number | null
}

/**
 * The sentence the server writes into a code-audit report (fileAuditFinding,
 * _shared/work-modes.ts: `Reproduced by the worker with no model: ${kind}
 * check, ${summary}`). Anchored on it, so a slash earlier on the line (a URL)
 * can never become part of the pattern.
 */
const CHECK_RE = /Reproduced by the worker with no model: pattern check, \/(.+)\/(i?) is (present|absent) in (\S+?)(?: near line (\d+))?(?=\s|$|[.,;)](?:\s|$))/m

/**
 * The pattern check a code-audit report was filed with, read back from its description; null when there is none,
 * or when it may have been cut short or names an unsafe path or pattern.
 */
export function parseAuditCheck(description: string | null | undefined): ParsedAuditCheck | null {
  if (!description) return null
  const m = CHECK_RE.exec(description)
  if (!m) return null
  // The summary part (from the first slash) may have been cut at SUMMARY_CAP.
  if (m[0].length - m[0].indexOf('/') >= SUMMARY_CAP - 5) return null
  const file = safePath(m[4]!.replace(/[.,;:]+$/, ''))
  const ignoreCase = m[2] === 'i'
  if (!file || !safeRegex(m[1], ignoreCase)) return null
  return { kind: 'pattern', regex: m[1]!, ignoreCase, expect: m[3] as 'present' | 'absent', file, line: m[5] ? Number(m[5]) : null }
}

type Recheck = { gone: true; reason: string } | { gone: false; reason: string | null }

/**
 * Does the report's own check still reproduce in `worktree`? `gone: true`
 * only when it is a code-audit report with a readable check, the file is
 * there, and the check no longer holds. An `absent` problem is also gone when
 * a shared wrapper around the cited line already has what was missing
 * (ADR 0063: glot's loading screens inside RouteLoadingShell).
 */
export function recheckReport(detail: { source?: string | null; description?: string | null }, worktree: string, readFile: (path: string) => string | null = readWorktreeFile): Recheck {
  if (detail.source !== 'code_audit') return { gone: false, reason: null }
  const check = parseAuditCheck(detail.description)
  if (!check) return { gone: false, reason: 'its check could not be read back, so the agent looks' }
  const readRel = (p: string) => readFile(join(worktree, p))
  const text = readRel(check.file)
  // A file that moved or was split may still hold the bug elsewhere: the agent looks.
  if (text === null) return { gone: false, reason: `${check.file} is not in the base branch any more, so the agent looks` }
  if (patternReproduces(text, check)) {
    if (check.expect === 'absent') {
      const re = safeRegex(check.regex, check.ignoreCase)
      const wrapper = re ? absentHeldByWrapper(check.file, text, check.line, re, readRel, (p) => readRel(p) !== null) : null
      if (wrapper) {
        return { gone: true, reason: `the shared component ${wrapper} that wraps line ${check.line} of ${check.file} already has /${check.regex}/${check.ignoreCase ? 'i' : ''}` }
      }
    }
    return { gone: false, reason: null }
  }
  // The audit looks 3 lines either side of the cited line. Code that only
  // moved (2026-11-12: 93 of 217 "gone" findings) still has the problem
  // elsewhere in the file: a `present` problem is gone only when the whole
  // file no longer has it.
  if (check.expect === 'present' && patternReproduces(text, { ...check, line: null })) {
    return { gone: false, reason: `the code moved away from line ${check.line ?? '?'} but is still in ${check.file}, so the agent looks` }
  }
  return {
    gone: true,
    reason: `its own check no longer reproduces: /${check.regex}/${check.ignoreCase ? 'i' : ''} is not ${check.expect} in ${check.file}${check.line ? ` near line ${check.line}` : ''}`,
  }
}

/** One labelled line of a code-audit report description (`What the user sees: …`). */
function descField(description: string | null | undefined, label: string): string {
  const m = new RegExp(`^${label}: (.*)$`, 'm').exec(description ?? '')
  return m ? m[1]!.trim() : ''
}

export interface BacklogRow {
  id: string
  project_id?: string | null
  source?: string | null
  status?: string | null
  severity?: string | null
  title?: string | null
  summary?: string | null
  description?: string | null
  created_at?: string | null
  custom_metadata?: { rule?: string | null; file?: string | null; line?: number | null; confidence?: number | null; pattern_key?: string | null } | null
}

/** @internal One pattern of a BacklogPlan; exported for its readers' types. */
export interface BacklogPattern {
  key: string
  category: string
  root: string
  /** The report that stays open for the pattern: the most severe, then the oldest. */
  parentId: string
  reportIds: string[]
  screens: string[]
}

export interface BacklogPlan {
  checked: number
  gone: Array<{ reportId: string; severity: string | null; reason: string }>
  stillThere: number
  unclear: number
  /** Every pattern the reports still there fall into, biggest first. */
  patterns: BacklogPattern[]
  /** Reports that would become duplicate children of a pattern parent. */
  collapsed: number
  /** Open reports left: one per pattern. */
  remaining: number
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

/**
 * What a recheck sweep would do to an open code-audit backlog, with no write: which reports are gone on the base
 * branch, and how the rest collapse into one report per pattern key
 * (category + root, ADR 0063). `mushi work --recheck --dry-run --json` prints it.
 */
export function planBacklog(rows: readonly BacklogRow[], worktree: string, readFile: (path: string) => string | null = readWorktreeFile): BacklogPlan {
  const plan: BacklogPlan = { checked: 0, gone: [], stillThere: 0, unclear: 0, patterns: [], collapsed: 0, remaining: 0 }
  const readRel = (p: string) => readFile(join(worktree, p))
  const byKey = new Map<string, { category: string; root: string; rows: BacklogRow[]; screens: Set<string> }>()
  for (const r of rows) {
    if (r.source !== 'code_audit') continue
    plan.checked++
    const res = recheckReport(r, worktree, readFile)
    if (res.gone) {
      plan.gone.push({ reportId: r.id, severity: r.severity ?? null, reason: res.reason })
      continue
    }
    if (res.reason) plan.unclear++
    else plan.stillThere++
    const where = /^(.+):(\d+)$/.exec(descField(r.description, 'Where'))
    const file = r.custom_metadata?.file ?? where?.[1] ?? parseAuditCheck(r.description)?.file ?? ''
    const rule = r.custom_metadata?.rule ?? ''
    const evidence = descField(r.description, 'The code there')
    const category = auditCategory({ rule, title: r.title ?? r.summary ?? '', userImpact: descField(r.description, 'What the user sees') })
    const root = file ? patternRoot(file, evidence, readRel(file), readRel, (p) => readRel(p) !== null) : `report:${r.id}`
    const key = r.custom_metadata?.pattern_key ?? auditPatternKey(category, root, rule || r.id)
    const g = byKey.get(`${r.project_id ?? ''}|${key}`) ?? { category, root, rows: [], screens: new Set<string>() }
    g.rows.push(r)
    const screen = /code-read audit of (\S+?) on the local/.exec(r.description ?? '')?.[1] ?? file
    if (screen) g.screens.add(screen)
    byKey.set(`${r.project_id ?? ''}|${key}`, g)
  }
  for (const [k, g] of byKey) {
    const sorted = [...g.rows].sort((a, b) => (SEVERITY_RANK[b.severity ?? ''] ?? 0) - (SEVERITY_RANK[a.severity ?? ''] ?? 0) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    plan.patterns.push({ key: k.slice(k.indexOf('|') + 1), category: g.category, root: g.root, parentId: sorted[0]!.id, reportIds: sorted.map((r) => r.id), screens: [...g.screens].sort() })
  }
  plan.patterns.sort((a, b) => b.reportIds.length - a.reportIds.length || a.key.localeCompare(b.key))
  plan.remaining = plan.patterns.length
  plan.collapsed = plan.patterns.reduce((n, p) => n + p.reportIds.length - 1, 0)
  return plan
}

const SHA_RE = /\b([0-9a-f]{7,40})\b/g

/** Commit ids an `already_fixed` verdict names, at most 3. */
export function verdictCommits(reason: string): string[] {
  return [...new Set([...reason.matchAll(SHA_RE)].map((m) => m[1]!).filter((s) => /[a-f]/.test(s) && /\d/.test(s)))].slice(0, 3)
}

/** The team note left on a report closed by a recheck. */
export function goneNote(reason: string, baseRef: string, sha: string | null): string {
  return `Closed by mushi work without an agent run: ${reason} (checked on ${baseRef}${sha ? ` at ${sha.slice(0, 9)}` : ''}). Reopen it if the problem is still there.`.slice(0, 4000)
}
