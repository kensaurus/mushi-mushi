/**
 * FILE: packages/server/supabase/functions/_shared/finding-explain.ts
 * PURPOSE: Turn one gate_findings row into a plain-English explanation —
 *          what the check is, why it fired, where, how to fix it, and whether
 *          it is still open — for GET /v1/admin/findings/:findingId and the
 *          explain_finding MCP tool. Pure: the route does the reads.
 *
 * Every gate stores its fix in `suggested_fix` with its own shape (radar and
 * store review `{ fix }`, recipe drift `{ kind, text }`, design deviance
 * `{ value, suggestion }`, setup checks `{ kind, step | path | command }`,
 * inventory gates `{ explanation }`). fixOf() reads all of them into one
 * sentence and always passes the raw object through as `detail`, so a shape
 * it does not know loses nothing.
 *
 * `message`, `file_path` and the fix can come from a host CI push, so the MCP
 * tool wraps the result as untrusted data.
 */

import { RADAR_RULES, type RadarRuleId } from './radar/types.ts'

export interface ExplainFindingRow {
  id: string
  gate_run_id: string
  project_id: string
  severity: string
  rule_id: string | null
  message: string
  file_path: string | null
  line: number | null
  col: number | null
  node_id: string | null
  suggested_fix: unknown
  allowlisted: boolean
  allowlist_reason: string | null
  created_at: string
}

export interface ExplainRunRow {
  id: string
  gate: string
  status: string
  started_at: string
  completed_at: string | null
  commit_sha: string | null
  /** The run's own summary: its phase (design_drift) and story scope (inventory gates) pick what it is compared with. */
  summary?: unknown
}

/** The newest finished run of the same gate, and the matching finding in it, if any. */
export interface ExplainLatestRun {
  id: string
  completed_at: string | null
  /** The same rule at the same place in that run; null when the run no longer has it. */
  matchingFindingId: string | null
  /** The matching finding in that run is allowlisted there (with this reason, when one was given). */
  matchingAllowlisted?: boolean
  matchingAllowlistReason?: string | null
  /**
   * Set when the run does not have the finding but that is no evidence it was
   * fixed (see absenceUnproven); the finding is then `unknown`, never fixed.
   */
  uncheckedReason: string | null
}

export type FindingOpenState = 'open' | 'not_in_latest_run' | 'unknown' | 'allowlisted'

/** How the newer run was searched for the same finding: by file, by stored target, or (weakest) by message. */
export type FindingMatchKey = 'file' | 'target' | 'message'

/** What a finished gate run says about the rules it ran, read back to judge a missing finding. */
export interface LatestRunEvidence {
  status: string
  /** gate_runs.findings_count: what the run found, before any storage cap. */
  findingsCount: number | null
  /** gate_findings rows actually stored for the run; null when not counted. */
  storedCount: number | null
  summary: unknown
  ruleId: string | null
  matchedBy: FindingMatchKey
}

/** Statuses of a run that finished and checked what it was asked to (error and skipped did not). */
const COMPLETE_RUN_STATUSES: ReadonlySet<string> = new Set(['pass', 'warn', 'fail'])

/** Per-rule states that mean the rule ran to the end on this run (radar and store summaries). */
const CHECKED_RULE_STATES: ReadonlySet<string> = new Set(['ok', 'finding'])

/** `mushi recipe check` stops collecting off-token literals at this many (the ingest schema caps it too). */
export const CI_SCAN_FINDINGS_CAP = 500

/**
 * Why a finding missing from the latest run is NOT evidence it was fixed, or
 * null when it is. Each of these proves nothing:
 *  - the run errored or skipped, unless its own record shows the finding's rule
 *    ran to the end (radar and store runs record a state per rule in
 *    summary.results: `ok` and `finding` mean it ran; a run is `error` when
 *    one connector failed, which says nothing about the others);
 *  - the rule has a per-rule entry that is not `ok` or `finding`, or no entry;
 *  - the run stored fewer findings than it found (a storage cap, or a findings
 *    insert that failed, recorded as summary.findings_not_stored);
 *  - the run read only part of the project: it stopped at its file limit
 *    (summary.truncated), read no files at all (summary.scannedFiles 0), or is
 *    a CI scan that hit the CLI's 500-finding cap;
 *  - the run could only be searched by a message that embeds counts or dates.
 */
export function absenceUnproven(e: LatestRunEvidence): string | null {
  const summary = asRecord(e.summary)
  const results = summary && Array.isArray(summary.results) ? summary.results.map(asRecord) : null
  const entry = results && e.ruleId !== null ? results.find((r) => r !== null && r.ruleId === e.ruleId) ?? null : null
  if (results && e.ruleId !== null) {
    if (!entry) return `the latest run did not run the ${e.ruleId} rule.`
    if (!CHECKED_RULE_STATES.has(String(entry.state))) {
      const why = str(entry.reason)
      return `the ${e.ruleId} rule was "${String(entry.state)}" in the latest run, not checked${why ? ` (${why})` : ''}.`
    }
  } else if (!COMPLETE_RUN_STATUSES.has(e.status)) {
    return `the latest run ended with status "${e.status}", so it did not check everything.`
  }
  if (e.findingsCount !== null && e.findingsCount > 0 && (e.storedCount === null || e.storedCount < e.findingsCount)) {
    return `the latest run found ${e.findingsCount} problem${e.findingsCount === 1 ? '' : 's'} but stored only ${e.storedCount ?? 'an unknown number of them'}, so this one may be among those not stored.`
  }
  const notStored = summary && typeof summary.findings_not_stored === 'number' ? summary.findings_not_stored : 0
  if (notStored > 0) {
    return `the latest run could not store ${notStored} of the problems it found, so this one may be among them.`
  }
  if (summary?.truncated === true) {
    return 'the latest run stopped at its file limit, so it may not have read the file this finding is in.'
  }
  if (summary && summary.scannedFiles === 0) {
    return 'the latest run read no files, so it checked nothing.'
  }
  if (summary?.phase === 'ci_scan' && (e.findingsCount ?? 0) >= CI_SCAN_FINDINGS_CAP) {
    return `the latest CI scan reported ${CI_SCAN_FINDINGS_CAP} problems, the most it sends, so it may have stopped before this one.`
  }
  if (e.matchedBy === 'message') {
    return 'this finding has no file or target to look for, and its message (which can carry counts or dates) is not in the latest run.'
  }
  return null
}

/**
 * Which design_drift runs a finding can be compared with. A server scan reads
 * the whole repo with every rule; a CI push (`mushi recipe check --push`,
 * phase `ci_scan`) checks only off-token hex literals in the files the host's
 * CI matched, so one kind's silence says nothing about the other's findings.
 */
export function designRunPhase(summary: unknown): 'scan' | 'ci_scan' {
  return asRecord(summary)?.phase === 'ci_scan' ? 'ci_scan' : 'scan'
}

/** The story subtree an inventory-gates run was scoped to, or null for a whole-project run. */
export function runStoryScope(summary: unknown): string | null {
  return str(asRecord(summary)?.story_node_id)
}

/**
 * A run scoped to a story examined only that subtree: it covers a finding only
 * when it is unscoped, or scoped to the same story as the finding's own run.
 */
export function runCoversScope(ownStory: string | null, runStory: string | null): boolean {
  return runStory === null || runStory === ownStory
}

export interface FindingFix {
  /** One sentence or a snippet to apply; null when the gate stored no fix it could be read from. */
  text: string | null
  kind: string | null
  /** A console path such as /settings?tab=keys, when the fix is a console step. */
  consolePath: string | null
  command: string | null
  /** The stored suggested_fix, unchanged. */
  detail: unknown
}

export interface FindingExplanation {
  id: string
  projectId: string
  gate: string
  gateLabel: string
  /** What the gate checks, in one sentence. */
  gateMeaning: string
  ruleId: string | null
  rule: { title: string; prevents: string } | null
  severity: string
  /** Why it fired: the finding's own message. */
  reason: string
  fix: FindingFix
  location: { filePath: string | null; line: number | null; col: number | null; target: string | null }
  state: FindingOpenState
  stateReason: string
  allowlistReason: string | null
  createdAt: string
  run: { id: string; status: string; startedAt: string; completedAt: string | null; commitSha: string | null }
  latestRun: { id: string; completedAt: string | null; findingId: string | null } | null
}

/** Every gate_runs.gate value, with a console label and what it checks. */
export const GATE_MEANINGS: Readonly<Record<string, { label: string; meaning: string }>> = {
  dead_handler: { label: 'Dead handler', meaning: 'A button or form in the inventory whose handler does nothing (no network call, no state change).' },
  mock_leak: { label: 'Mock leak', meaning: 'Mock or fixture data reachable from production code.' },
  api_contract: { label: 'API contract', meaning: 'A frontend call whose request or response does not match the backend route it hits.' },
  crawl: { label: 'Crawl', meaning: 'A live-app crawl found a page or action that fails for a real user.' },
  status_claim: { label: 'Status claim', meaning: 'An inventory action claims a status (for example "verified") that its tests and observations do not support.' },
  spec_drift: { label: 'Spec drift', meaning: 'The OpenAPI or inventory spec disagrees with the routes the code really serves.' },
  orphan_endpoint: { label: 'Orphan endpoint', meaning: 'A backend route no frontend has called in 30 days: dead code, or a caller Mushi cannot see.' },
  unknown_call: { label: 'Unknown call', meaning: 'The app calls a network path no backend declares: a likely 404 or a missing deploy.' },
  schema_drift: { label: 'Schema drift', meaning: 'The live database schema changed from the last snapshot or from the migrations in the repo.' },
  code_health: { label: 'Code health', meaning: 'A file too large to change safely, or a bundle over its size budget, pushed from your CI.' },
  design_drift: { label: 'Design drift', meaning: 'Code that uses a hard-coded colour, size or font instead of the design tokens.' },
  ci_drift: { label: 'CI drift', meaning: 'A CI workflow that drifts from the recipe: no concurrency or timeout, macOS on every run, long artifact retention, or a red default branch.' },
  deploy_drift: { label: 'Deploy drift', meaning: 'What is live differs from what was merged: a fix not deployed yet, a failed version probe, or web and mobile on different versions.' },
  env_drift: { label: 'Env drift', meaning: 'An environment variable the app declares is missing where it runs (CI or deploy).' },
  portfolio_radar: { label: 'Hole check', meaning: 'A problem no user has hit yet: an expiring domain or certificate, store listings out of sync, missing security headers, a broken privacy link.' },
  portfolio_radar_ci: { label: 'Hole check (CI)', meaning: 'A hole found by the scan your CI ran on the repo, for example an outdated store SDK target.' },
  store_review: { label: 'Store review', meaning: 'The store listing checked against the code and the live stores: claims the code contradicts, privacy labels, screenshots, length limits.' },
  radar: { label: 'Mushi setup check', meaning: 'Part of the Mushi setup itself is not working: a rejected AI key, a webhook that never arrives, no spend cap on autofix.' },
}

const RADAR_RULE_LOOKUP: Readonly<Record<string, { title: string; prevents: string }>> = RADAR_RULES

function isRadarRuleId(id: string): id is RadarRuleId {
  return Object.prototype.hasOwnProperty.call(RADAR_RULE_LOOKUP, id)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Read any stored suggested_fix shape into one fix. */
export function fixOf(suggested: unknown): FindingFix {
  const empty: FindingFix = { text: null, kind: null, consolePath: null, command: null, detail: suggested ?? null }
  const plain = str(suggested)
  if (plain) return { ...empty, text: plain }
  const o = asRecord(suggested)
  if (!o) return empty

  const kind = str(o.kind)
  const command = str(o.command)
  const consolePath = str(o.console_path) ?? (kind === 'console' ? str(o.path) : null)
  const base: FindingFix = { ...empty, kind, command, consolePath }

  // radar / store review, recipe drift, setup steps, inventory gates
  const direct = str(o.fix) ?? str(o.text) ?? str(o.step) ?? str(o.explanation)
  if (direct) return { ...base, text: direct }

  // design deviance: the literal and the nearest token to use instead
  const suggestion = asRecord(o.suggestion)
  const token = suggestion ? str(suggestion.token) : null
  if (token) {
    const literal = str(o.value)
    const cssVar = suggestion ? str(suggestion.cssVar) : null
    return {
      ...base,
      text: `Replace ${literal ? `\`${literal}\`` : 'the hard-coded value'} with the design token ${token}${cssVar ? ` (var(${cssVar}))` : ''}.`,
    }
  }

  if (command) return { ...base, text: `Run \`${command}\`.` }

  // console settings: fields to save
  const values = asRecord(o.values)
  if (consolePath) {
    const pairs = values ? Object.entries(values).map(([k, v]) => `${k} = ${String(v)}`) : []
    return { ...base, text: `Open ${consolePath} in the Mushi console${pairs.length ? ` and set ${pairs.join(', ')}` : ''}.` }
  }
  const field = str(o.field)
  if (field && o.value !== undefined && o.value !== null) {
    return { ...base, text: `Set ${field} to ${String(o.value)}.` }
  }
  return base
}

/**
 * The stable thing a file-less finding is about (a domain, host, URL, route or
 * API path) and the suggested_fix key it is stored under, so a newer run can
 * be searched for the same target instead of a message that embeds counts or
 * dates ("expires in 12 days (2026-10-15)").
 */
export function findingTargetKey(suggested: unknown): { key: 'target' | 'route' | 'path'; value: string } | null {
  const o = asRecord(suggested)
  if (!o) return null
  const target = str(o.target)
  if (target) return { key: 'target', value: target }
  const route = str(o.route)
  if (route) return { key: 'route', value: route }
  // `path` is a console path when the fix has a kind (console step), and the
  // API path the finding is about otherwise (unknown_call, spec_drift).
  const path = str(o.kind) ? null : str(o.path)
  return path ? { key: 'path', value: path } : null
}

function targetOf(suggested: unknown): string | null {
  return findingTargetKey(suggested)?.value ?? null
}

function stateOf(
  finding: ExplainFindingRow,
  latest: ExplainLatestRun | null,
): { state: FindingOpenState; reason: string } {
  if (finding.allowlisted) {
    return {
      state: 'allowlisted',
      reason: finding.allowlist_reason
        ? `Allowlisted: ${finding.allowlist_reason}`
        : 'Allowlisted: someone marked it as accepted, so it no longer counts against the gate.',
    }
  }
  if (!latest) {
    return { state: 'open', reason: 'No finished run of this check has looked again since it was found.' }
  }
  if (latest.id === finding.gate_run_id) {
    return { state: 'open', reason: 'It is in the latest run of this check.' }
  }
  if (latest.matchingFindingId) {
    if (latest.matchingAllowlisted) {
      return {
        state: 'allowlisted',
        reason: latest.matchingAllowlistReason
          ? `A newer run still finds it, and it is allowlisted there: ${latest.matchingAllowlistReason}`
          : 'A newer run still finds it, and someone marked it there as accepted.',
      }
    }
    return { state: 'open', reason: 'A newer run of this check found the same problem in the same place.' }
  }
  if (latest.uncheckedReason) {
    return {
      state: 'unknown',
      reason: `The latest run of this check could not confirm it is fixed: ${latest.uncheckedReason}`,
    }
  }
  return {
    state: 'not_in_latest_run',
    reason: 'The latest run of this check no longer reports it: it was fixed, or the code moved.',
  }
}

export function explainFinding(
  finding: ExplainFindingRow,
  run: ExplainRunRow,
  latest: ExplainLatestRun | null,
): FindingExplanation {
  const gate = GATE_MEANINGS[run.gate] ?? { label: run.gate, meaning: 'A Mushi check on this project.' }
  const rule = finding.rule_id && isRadarRuleId(finding.rule_id)
    ? { title: RADAR_RULE_LOOKUP[finding.rule_id].title, prevents: RADAR_RULE_LOOKUP[finding.rule_id].prevents }
    : null
  const { state, reason } = stateOf(finding, latest)
  return {
    id: finding.id,
    projectId: finding.project_id,
    gate: run.gate,
    gateLabel: gate.label,
    gateMeaning: gate.meaning,
    ruleId: finding.rule_id,
    rule,
    severity: finding.severity,
    reason: finding.message,
    fix: fixOf(finding.suggested_fix),
    location: { filePath: finding.file_path, line: finding.line, col: finding.col, target: targetOf(finding.suggested_fix) },
    state,
    stateReason: reason,
    allowlistReason: finding.allowlist_reason,
    createdAt: finding.created_at,
    run: { id: run.id, status: run.status, startedAt: run.started_at, completedAt: run.completed_at, commitSha: run.commit_sha },
    latestRun: latest ? { id: latest.id, completedAt: latest.completed_at, findingId: latest.id === finding.gate_run_id ? finding.id : latest.matchingFindingId } : null,
  }
}
