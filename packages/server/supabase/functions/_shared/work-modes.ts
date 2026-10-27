/**
 * FILE: packages/server/supabase/functions/_shared/work-modes.ts
 * PURPOSE: The rules of the local worker's P3 lane modes, with no I/O, so
 *          vitest and Deno test them directly. Used by api/routes/work.ts and
 *          the merge-queue function.
 *
 *   conflicts (ADR 0049, amends ADR 0032, under ADR 0041's cap): which
 *     merge-queue rows a lane may claim, whether a run gives its cap slot
 *     back, and what the queue row says after the run.
 *   audit (ADR 0050): the finding a worker files, its dedupe key (file + rule
 *     + a hash of the evidence line, computed here, never taken from model
 *     wording), the safety screen, the hourly cap and the report text.
 *
 * Pure: no Deno globals, no npm: specifiers.
 */

import { MAX_CONFLICT_AGENTS } from './merge-queue.ts'
import { screenFindings } from './review-followup.ts'

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string }

/** Why this outcome cannot end a claim of this kind, or null: a fix opens PRs, a conflict pushes merges, an audit files findings. */
export function outcomeKindRefusal(outcome: string, kind: 'fix' | 'conflict' | 'audit'): string | null {
  if ((outcome === 'pr_opened' || outcome === 'verdict') && kind !== 'fix') return 'Only a fix claim opens a pull request or ends on a verdict.'
  if ((outcome === 'pushed' || outcome === 'refused') && kind !== 'conflict') return 'Only a conflict claim pushes a merge or is refused by its checks.'
  if (outcome === 'filed' && kind !== 'audit') return 'Only an audit claim files findings.'
  return null
}

// ── Conflicts (ADR 0049) ────────────────────────────────────────────────────

/** A lane does not take the same PR again within this long after its last local run ended. */
export const LOCAL_CONFLICT_RETRY_MS = 60 * 60_000

/** The fix_merge_queue columns the conflict rules read. */
export interface ConflictQueueRow {
  id: string
  project_id: string
  repo: string
  pr_number: number
  state: string
  detail: string | null
  head_sha: string | null
  conflict_agents: number | null
  cursor_agent_id: string | null
  local_claim_id: string | null
  claimed_until: string | null
  queued_at: string
}

/**
 * True when the row waits for a conflict agent: the release train marked it
 * `resolving` and no agent took it yet, or a cloud agent could not start or
 * could not resolve it (resolve() and processRow() write "Merge conflict…").
 */
export function conflictWaiting(row: Pick<ConflictQueueRow, 'state' | 'detail' | 'cursor_agent_id' | 'local_claim_id'>): boolean {
  if (row.cursor_agent_id || row.local_claim_id) return false
  if (row.state === 'resolving') return true
  return row.state === 'blocked' && (row.detail ?? '').startsWith('Merge conflict')
}

/**
 * Why a lane may not claim this row now, or null. `laneRepo` is the lane's
 * clone (owner/name, lower case); `branch` the PR's head branch as Mushi
 * recorded it; `lastLocalEndAt` when the last local run on the row ended.
 */
export function conflictClaimBlock(
  row: ConflictQueueRow,
  ctx: { laneRepo: string | null; branch: string | null; lastLocalEndAt: string | null; now: Date },
): string | null {
  if (!ctx.laneRepo) return 'This worker does not say which repository the lane\'s clone is. Update the Mushi CLI on the machine.'
  if (row.repo.toLowerCase() !== ctx.laneRepo.toLowerCase()) return `The PR is in ${row.repo}, not in this lane's clone (${ctx.laneRepo}).`
  if (!conflictWaiting(row)) return 'The PR does not wait for a conflict agent.'
  if ((row.conflict_agents ?? 0) >= MAX_CONFLICT_AGENTS) return `Both conflict agents (${MAX_CONFLICT_AGENTS} of ${MAX_CONFLICT_AGENTS}) were used on this PR.`
  if (!row.head_sha || !/^[0-9a-f]{40}$/.test(row.head_sha)) return 'Mushi has not recorded the PR\'s head commit yet.'
  if (row.claimed_until && Date.parse(row.claimed_until) > ctx.now.getTime()) return 'The merge queue is checking this PR right now.'
  if ((ctx.branch ?? '').startsWith('mushi/revert-')) return 'A revert PR is never merged into by an agent.'
  if (ctx.lastLocalEndAt && ctx.now.getTime() - Date.parse(ctx.lastLocalEndAt) < LOCAL_CONFLICT_RETRY_MS) {
    return 'A local worker tried this PR less than an hour ago.'
  }
  return null
}

/** Oldest in the queue first, then by PR number (the merge queue's own order). */
export function rankConflictRows<T extends Pick<ConflictQueueRow, 'queued_at' | 'pr_number'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.queued_at ?? '').localeCompare(b.queued_at ?? '') || a.pr_number - b.pr_number)
}

/**
 * True when a local conflict run gives its cap slot back: the machine failed
 * (infra), the worker stopped or skipped before an agent could resolve
 * anything, or its lease ran out. ADR 0048: the machine never counts against
 * the PR. A run whose agent finished and failed the checks keeps the slot.
 */
export function conflictSlotBack(outcome: string, failureKind: string | null): boolean {
  if (outcome === 'skipped' || outcome === 'stopped' || outcome === 'lease_expired') return true
  return (outcome === 'failed' || outcome === 'timeout') && failureKind === 'infra'
}

/** The fix_merge_queue patch after a local conflict run ends. The detail of a row left blocked starts "Merge conflict" so a later agent may take it. */
export function conflictRowAfterRun(run: { outcome: string; failureKind: string | null; detail: string | null; headAfter: string | null; laneName: string }): Record<string, unknown> {
  if (run.outcome === 'pushed' && run.headAfter) {
    return {
      state: 'waiting',
      head_sha: run.headAfter,
      local_claim_id: null,
      detail: `A local worker (${run.laneName}) merged the base branch in (${run.headAfter.slice(0, 7)}); the queue checks it and Opus reviews the new head.`,
    }
  }
  const why = (run.detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) || run.outcome
  const again = conflictSlotBack(run.outcome, run.failureKind)
  return {
    state: 'blocked',
    local_claim_id: null,
    detail: again
      ? `Merge conflict: the local worker (${run.laneName}) stopped before it finished (${why}); another agent may take it.`
      : `Merge conflict: the local worker (${run.laneName}) could not resolve it (${why}).`,
  }
}

// ── Audit (ADR 0050) ────────────────────────────────────────────────────────

/** Code-audit findings one app may file an hour, below FILED_REPORTS_PER_HOUR (30) so a person can still file. */
export const AUDIT_FINDINGS_PER_HOUR = 12
/** The deterministic checks a worker runs itself. Never a command the model wrote (ADR 0050). */
export const AUDIT_CHECK_KINDS = ['pattern', 'script'] as const
export type AuditCheckKind = (typeof AUDIT_CHECK_KINDS)[number]
export const AUDIT_SEVERITIES = ['high', 'medium', 'low'] as const

export interface AuditFinding {
  title: string
  severity: (typeof AUDIT_SEVERITIES)[number]
  /** Repo-relative path, forward slashes. */
  file: string
  line: number
  /** A short slug naming the kind of problem (missing-label, wrong-locale, …). */
  rule: string
  /** The code on `file:line`, as the worker read it from the file. */
  evidenceLine: string
  userImpact: string
  fix: string
  doneWhen: string
  /** Which check reproduced it, and what the check was, in one line. */
  check: { kind: AuditCheckKind; summary: string }
  /** The screen or module this audit pass read. */
  screen: string
  proposedBy: string | null
  vetoBy: string | null
}

const SAFE_PATH_RE = /^[A-Za-z0-9_@()[\]+.-]+(?:\/[A-Za-z0-9_@()[\]+.-]+)*$/
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/

function text(raw: unknown, field: string, min: number, max: number): Parsed<string> {
  if (typeof raw !== 'string') return { ok: false, message: `${field} is required.` }
  const t = raw.replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').trim()
  if (t.length < min) return { ok: false, message: `${field} needs at least ${min} characters.` }
  if (t.length > max) return { ok: false, message: `${field} is at most ${max} characters.` }
  return { ok: true, value: t }
}

/** A repo-relative path: no leading slash, no `..`, no backslash, nothing but path characters. */
export function safeRepoPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.trim().replace(/^\.\//, '')
  if (!p || p.length > 300 || !SAFE_PATH_RE.test(p)) return null
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return null
  return p
}

/** Parse the finding a worker sends; every field is checked, nothing unknown is kept. */
export function parseAuditFinding(raw: unknown): Parsed<AuditFinding> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'Send the finding as a JSON object.' }
  const b = raw as Record<string, unknown>
  const title = text(b.title, 'title', 3, 200)
  if (!title.ok) return title
  if (typeof b.severity !== 'string' || !(AUDIT_SEVERITIES as readonly string[]).includes(b.severity)) return { ok: false, message: 'severity must be high, medium or low.' }
  const file = safeRepoPath(b.file)
  if (!file) return { ok: false, message: 'file must be a path inside the repository (no leading slash, no "..").' }
  if (typeof b.line !== 'number' || !Number.isInteger(b.line) || b.line < 1 || b.line > 1_000_000) return { ok: false, message: 'line must be a line number.' }
  const rule = typeof b.rule === 'string' ? b.rule.trim().toLowerCase() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,59}$/.test(rule)) return { ok: false, message: 'rule must be a short slug (letters, digits, "-").' }
  const evidence = text(b.evidenceLine, 'evidenceLine', 1, 500)
  if (!evidence.ok) return evidence
  const impact = text(b.userImpact, 'userImpact', 3, 1000)
  if (!impact.ok) return impact
  const fix = text(b.fix, 'fix', 3, 1000)
  if (!fix.ok) return fix
  const doneWhen = text(b.doneWhen, 'doneWhen', 3, 500)
  if (!doneWhen.ok) return doneWhen
  const c = (b.check ?? {}) as Record<string, unknown>
  if (typeof c.kind !== 'string' || !(AUDIT_CHECK_KINDS as readonly string[]).includes(c.kind)) {
    return { ok: false, message: `check.kind must be one of ${AUDIT_CHECK_KINDS.join(', ')}.` }
  }
  const summary = text(c.summary, 'check.summary', 3, 300)
  if (!summary.ok) return summary
  const screen = safeRepoPath(b.screen)
  if (!screen) return { ok: false, message: 'screen must be the path of the screen or module the audit read.' }
  const model = (v: unknown) => (typeof v === 'string' && MODEL_RE.test(v) ? v : null)
  return {
    ok: true,
    value: {
      title: title.value,
      severity: b.severity as AuditFinding['severity'],
      file,
      line: b.line,
      rule,
      evidenceLine: evidence.value,
      userImpact: impact.value,
      fix: fix.value,
      doneWhen: doneWhen.value,
      check: { kind: c.kind as AuditCheckKind, summary: summary.value },
      screen,
      proposedBy: model(b.proposedBy),
      vetoBy: model(b.vetoBy),
    },
  }
}

/**
 * Null when the finding is safe to file; otherwise why not. A filed report
 * feeds a fix agent's prompt later, so the review follow-up screen applies:
 * nothing that reads as an instruction to a model, touches CI or secrets,
 * holds something to run, or sends the agent to a foreign URL.
 */
export function auditFindingRefusal(f: AuditFinding): string | null {
  const { dropped } = screenFindings(
    [{ severity: 'major', file: f.file, line: f.line, issue: `${f.title}\n${f.userImpact}\n${f.evidenceLine}\n${f.check.summary}`, suggested_fix: `${f.fix}\n${f.doneWhen}` }],
    { files: [{ filename: f.file }], complete: false, patches: [] },
  )
  if (dropped.injection) return 'The finding reads as an instruction to a model.'
  if (dropped.ciConfig) return 'The finding touches CI, secrets or deploy configuration; a code audit does not file those.'
  if (dropped.command) return 'The finding holds something to run.'
  if (dropped.url) return 'The finding sends the fix to a URL that is not in the code.'
  return null
}

/** The evidence line as the key hashes it: whitespace collapsed, trimmed. */
export function normalizeEvidence(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

/** file + rule + the first 16 hex of sha256(evidence line): the same evidence for the same rule is one finding. */
export async function auditKey(f: Pick<AuditFinding, 'file' | 'rule' | 'evidenceLine'>): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeEvidence(f.evidenceLine))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${f.file}:${f.rule}:${hex.slice(0, 16)}`
}

/** An existing key blocks a new report while its report is open or was dismissed; a fixed one may be filed again (the evidence is still there). */
export function auditKeyBlocks(existingReportStatus: string | null): boolean {
  if (existingReportStatus == null) return false
  return !['fixed', 'verified'].includes(existingReportStatus)
}

/** The report a reproduced finding becomes. */
export function auditReportText(f: AuditFinding, ctx: { laneName: string }): { title: string; description: string; component: string } {
  const description = [
    f.title,
    '',
    `Where: ${f.file}:${f.line}`,
    `The code there: ${f.evidenceLine}`,
    `What the user sees: ${f.userImpact}`,
    `Fix: ${f.fix}`,
    `Done when: ${f.doneWhen}`,
    '',
    `Reproduced by the worker with no model: ${f.check.kind} check, ${f.check.summary}`,
    `Found by the code-read audit of ${f.screen} on the local worker lane ${ctx.laneName}${f.proposedBy ? ` (proposed by ${f.proposedBy}` : ''}${f.proposedBy ? (f.vetoBy ? `, not vetoed by ${f.vetoBy})` : ')') : ''}.`,
  ].join('\n')
  return { title: f.title, description: description.slice(0, 10_000), component: f.screen.slice(0, 200) }
}
