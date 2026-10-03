/**
 * FILE: packages/server/supabase/functions/_shared/design-ci-push.ts
 * PURPOSE: Turn a deviance scan pushed by `mushi recipe check --push` into a
 *          scored `design_drift` gate run, exactly like a server scan:
 *            - the CLI ran the shared engine (design-scan.ts) over the repo,
 *              so its literal findings use the server's rule ids;
 *            - nothing it sends is a verdict: severity comes from the
 *              snapshot's rules, a disabled rule or skipped file is dropped,
 *              contrast is judged here from the tokens, and the score is
 *              computed here with scoreDeviance;
 *            - a default-branch push is written as `phase: 'scan',
 *              source: 'ci'`, its findings in the shape loadRunFindings
 *              reads, and the `design.deviance_score` metric; a push of any
 *              other branch is `phase: 'ci_branch_scan'` (findings and the CI
 *              gate, never the shown score, metric or auto-fix baseline);
 *            - the project's opt-in actions run (design-actions.ts): the CI
 *              gate always, the auto-fix only for a push of the default branch.
 */

import type { getServiceClient } from './db.ts'
import { actOnDesignDeviance, devianceGate, loadDesignActionSettings, type ActOutcome, type DevianceGate } from './design-actions.ts'
import { devianceStatus, LITERAL_RULES, sortFindings } from './design-deviance.ts'
import type { DesignRuleId, DevianceFinding, DevianceSuggestion } from './design-engine-types.ts'
import { CI_BRANCH_SCAN_PHASE, DESIGN_GATE, loadCurrentSnapshot, recordDevianceMetric, storeScanFindings } from './design-plane.ts'
import { effectiveDesignRules } from './design-rules.ts'
import { scoreDeviance } from './design-scan.ts'
import { judgingSet } from './design-set-plan.ts'
import { matchAny, normalizeRepoPath } from './recipe-glob.ts'

type Db = ReturnType<typeof getServiceClient>

export interface CiDeviancePush {
  scannedFiles: number
  scannedLines: number
  matchedFiles: number
  truncated: boolean
  counts: Record<string, number>
  /** The CLI's own score; the server's is the one stored. */
  score?: number | null
  findings: Array<{ ruleId: string; filePath: string; line: number; col: number | null; value: string; message: string; suggestion: DevianceSuggestion | null }>
}

export interface CiDevianceResult {
  status: 'pass' | 'warn' | 'fail' | 'error' | 'skipped'
  runId: string | null
  score: number | null
  /** The CLI's score when it differs from the server's (an engine version mismatch). */
  clientScore: number | null
  storedFindings: number
  /** Findings refused: unknown or disabled rule, unsafe path, or a file the rule skips. */
  droppedFindings: number
  gate: DevianceGate | null
  action: ActOutcome | null
  reason: string | null
}

export interface CiPushDeps {
  now: () => Date
  act: typeof actOnDesignDeviance
}

export const defaultCiPushDeps: CiPushDeps = { now: () => new Date(), act: actOnDesignDeviance }

/** The primary repo's default branch ('main' when none is recorded); null when the read failed, so nothing auto-dispatches. */
async function defaultBranchOf(db: Db, projectId: string): Promise<string | null> {
  const { data, error } = await db.from('project_repos').select('default_branch').eq('project_id', projectId).eq('is_primary', true).maybeSingle()
  if (error) return null
  return ((data as { default_branch?: string | null } | null)?.default_branch ?? null) || 'main'
}

export async function recordCiDeviance(
  db: Db,
  projectId: string,
  input: { commitSha: string; branch: string; push: CiDeviancePush },
  deps: CiPushDeps = defaultCiPushDeps,
): Promise<CiDevianceResult> {
  const skipped = (reason: string): CiDevianceResult => ({ status: 'skipped', runId: null, score: null, clientScore: input.push.score ?? null, storedFindings: 0, droppedFindings: 0, gate: null, action: null, reason })
  const snapshot = await loadCurrentSnapshot(db, projectId)
  const set = judgingSet(snapshot?.tokens ?? null)
  if (!snapshot?.manifest || !set) return skipped('No design tokens to judge against, so the scan was not scored.')

  const rules = effectiveDesignRules(snapshot.manifest)
  const byId = new Map(rules.map((r) => [r.id as string, r]))
  const literal: DevianceFinding[] = []
  let dropped = 0
  for (const f of input.push.findings) {
    const rule = byId.get(f.ruleId)
    const path = normalizeRepoPath(f.filePath)
    if (!rule || !rule.enabled || !LITERAL_RULES.includes(rule.id) || !path || (rule.allowFiles.length > 0 && matchAny(path, rule.allowFiles))) {
      dropped++
      continue
    }
    literal.push({ rule_id: rule.id, severity: rule.severity, file_path: path, line: f.line, col: f.col, value: f.value, message: f.message, suggestion: f.suggestion })
  }
  const counts: Partial<Record<DesignRuleId, number>> = {}
  for (const id of LITERAL_RULES) {
    if (!byId.get(id)?.enabled) continue
    const listed = literal.filter((f) => f.rule_id === id).length
    const n = Math.max(listed, Math.floor(input.push.counts[id] ?? 0))
    if (n > 0) counts[id] = n
  }
  const scored = scoreDeviance(snapshot, { counts, scannedLines: input.push.scannedLines, scannedFiles: input.push.scannedFiles })
  const findings = sortFindings([...literal, ...scored.contrastFindings])
  const status = devianceStatus(findings)
  const total = Object.values(scored.counts).reduce((a, b) => a + (b ?? 0), 0)
  const startedAt = deps.now().toISOString()
  // Only a push of the default branch is the app's design state. Any other
  // branch (every PR run) is stored as its own phase, which never becomes the
  // shown score, the metric or the auto-fix baseline, and may never spend.
  const onDefault = input.branch === (await defaultBranchOf(db, projectId))
  const phase = onDefault ? 'scan' : CI_BRANCH_SCAN_PHASE
  const base = {
    phase,
    source: 'ci',
    branch: input.branch,
    score: scored.score,
    breakdown: scored.breakdown,
    counts: scored.counts,
    scannedFiles: input.push.scannedFiles,
    scannedLines: input.push.scannedLines,
    matchedFiles: input.push.matchedFiles,
    truncated: input.push.truncated,
    snapshotId: snapshot.id,
    tokensHash: snapshot.tokens_hash,
    set: set.name,
  }
  const { data: run, error: runErr } = await db
    .from('gate_runs')
    .insert({ project_id: projectId, gate: DESIGN_GATE, status: 'running', commit_sha: input.commitSha, triggered_by: 'ci', summary: { phase, source: 'ci' }, started_at: startedAt })
    .select('id')
    .single()
  if (runErr || !run) throw new Error(`gate_runs insert failed: ${runErr?.message ?? 'no row returned'}`)
  const runId = (run as { id: string }).id
  const clientScore = input.push.score !== undefined && input.push.score !== scored.score ? input.push.score : null

  let stored: number
  try {
    stored = await storeScanFindings(db, projectId, runId, findings)
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    await db.from('gate_runs').update({ status: 'error', summary: { phase, source: 'ci', error: message.slice(0, 500) }, completed_at: deps.now().toISOString() }).eq('id', runId)
    return { status: 'error', runId, score: null, clientScore, storedFindings: 0, droppedFindings: dropped, gate: null, action: null, reason: message }
  }

  const settings = await loadDesignActionSettings(db, projectId)
  const gate = settings.ok ? devianceGate(settings.settings, scored.score) : null
  const action: ActOutcome = onDefault
    ? await deps.act(db, { projectId, runId, score: scored.score, findings, branch: input.branch }, settings)
    : { action: 'not_default_branch' }

  const completedAt = deps.now().toISOString()
  const summary = { ...base, storedFindings: stored, droppedFindings: dropped, ...(action.action === 'off' ? {} : { action }) }
  const { error: upErr } = await db.from('gate_runs').update({ status, summary, findings_count: total, completed_at: completedAt }).eq('id', runId)
  if (upErr) throw new Error(`gate_runs update failed: ${upErr.message}`)
  if (onDefault) await recordDevianceMetric(db, projectId, set.name, completedAt, scored.score)
  return {
    status,
    runId,
    score: scored.score,
    clientScore,
    storedFindings: stored,
    droppedFindings: dropped,
    gate,
    action,
    reason: settings.ok ? null : `Design settings could not be read (${settings.error}); the CI gate was not applied.`,
  }
}
