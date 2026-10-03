/**
 * FILE: packages/server/supabase/functions/_shared/design-ci-push.ts
 * PURPOSE: Turn a deviance scan pushed by `mushi recipe check --push` into a
 *          scored `design_drift` gate run, exactly like a server scan:
 *            - the CLI ran the shared engine (design-scan.ts) over the repo,
 *              so its literal findings use the server's rule ids;
 *            - nothing it sends is a verdict or a text: each finding is
 *              judged again here (rejudgeLiteral) from its rule, file and
 *              value, so severity, message and suggestion are the server's,
 *              and a value that is not a literal of that rule is refused;
 *              contrast is judged here from the tokens, and the score is
 *              computed here with scoreDeviance;
 *            - a default-branch push is written as `phase: 'scan',
 *              source: 'ci'`, its findings in the shape loadRunFindings
 *              reads, and the `design.deviance_score` metric; a push of any
 *              other branch is `phase: 'ci_branch_scan'` (findings and the CI
 *              gate, never the shown score, metric or auto-fix baseline);
 *            - the default branch is the primary repo's, else the manifest's
 *              `ci.defaultBranch` (what `mushi recipe init` writes), else main;
 *            - a public key's default-branch push is `phase:
 *              'ci_untrusted_scan'`: it keeps the CI gate, and never sets the
 *              score, the baseline or dispatches. A key is public when a web
 *              page sent it, or when it is an SDK key (report:write only, no
 *              agent scope): that key ships inside the app, web or native,
 *              and a native app sends no browser header;
 *            - a pushed file path must be a plain code path (CI_FILE_PATH_RE),
 *              since it is written into the report a fixing agent reads;
 *            - the client's per-rule counts count above the findings it
 *              listed only when its listing was full (the CLI lists 500), so
 *              a push cannot lift its score with numbers alone;
 *            - the project's opt-in actions run (design-actions.ts): the CI
 *              gate always, even when storing the findings failed; the
 *              auto-fix only for a trusted push of the default branch.
 */

import type { getServiceClient } from './db.ts'
import { actOnDesignDeviance, DESIGN_SCAN_PHASE, devianceGate, loadDesignActionSettings, type ActOutcome, type DevianceGate, type UntrustedKeyReason } from './design-actions.ts'
import { buildDevianceContext, devianceStatus, LITERAL_RULES, rejudgeLiteral, sortFindings } from './design-deviance.ts'
import type { DesignRuleId, DevianceFinding, DevianceSuggestion } from './design-engine-types.ts'
import { CI_BRANCH_SCAN_PHASE, CI_UNTRUSTED_SCAN_PHASE, DESIGN_GATE, loadCurrentSnapshot, recordDevianceMetric, storeScanFindings, type SnapshotRow } from './design-plane.ts'
import { effectiveDesignRules } from './design-rules.ts'
import { SCAN_LIMITS, scoreDeviance } from './design-scan.ts'
import { judgingSet } from './design-set-plan.ts'
import { normalizeRepoPath } from './recipe-glob.ts'

type Db = ReturnType<typeof getServiceClient>

export interface CiDeviancePush {
  scannedFiles: number
  scannedLines: number
  matchedFiles: number
  truncated: boolean
  counts: Record<string, number>
  /** The CLI's own score; the server's is the one stored. */
  score?: number | null
  /** `message` and `suggestion` are accepted for older CLIs and never stored: the server rebuilds both. */
  findings: Array<{ ruleId: string; filePath: string; line: number; col: number | null; value: string; message: string; suggestion: DevianceSuggestion | null }>
}

/** Why the pushing key is public (a web page sent it, or it is an SDK key), or null for a private agent key. */
export type CiKeyExposure = UntrustedKeyReason | null

export interface CiDevianceInput {
  commitSha: string
  branch: string
  push: CiDeviancePush
  keyExposure: CiKeyExposure
}

export interface CiDevianceResult {
  status: 'pass' | 'warn' | 'fail' | 'error' | 'skipped'
  runId: string | null
  score: number | null
  /** The CLI's score when it differs from the server's (an engine version mismatch). */
  clientScore: number | null
  storedFindings: number
  /** Findings refused: unknown or disabled rule, unsafe path, a file the rule skips, or a value that is not a finding. */
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

const BRANCH_RE = /^[\w./-]{1,200}$/
/**
 * A pushed file path: segments of word characters and `@ . + $ ( ) [ ] -`
 * (route folders like `(auth)`, `[id]` and `@modal` included), at most
 * CI_FILE_PATH_MAX characters. No spaces, so no prose can ride along into the
 * report text a fixing agent reads; a path outside it is refused.
 */
export const CI_FILE_PATH_RE = /^[\w@.+$()[\]-]+(?:\/[\w@.+$()[\]-]+)*$/
export const CI_FILE_PATH_MAX = 300
/** The most findings the CLI lists in one push (pushPayload's default). */
const CLI_LISTED_MAX = SCAN_LIMITS.maxStoredFindings

/** normalizeRepoPath, then the plain-code-path shape; null when refused. */
export function ciFilePath(raw: string): string | null {
  const path = normalizeRepoPath(raw)
  return path && path.length <= CI_FILE_PATH_MAX && CI_FILE_PATH_RE.test(path) ? path : null
}

/**
 * The project's default branch: the primary repo's, else the manifest's
 * `ci.defaultBranch`, else 'main'. Null when the repo read failed, so the push
 * is never taken for the app's state on a guess.
 */
export async function defaultBranchOf(db: Db, projectId: string, manifest: SnapshotRow['manifest']): Promise<string | null> {
  const { data, error } = await db.from('project_repos').select('default_branch').eq('project_id', projectId).eq('is_primary', true).maybeSingle()
  if (error) return null
  const fromRepo = (data as { default_branch?: string | null } | null)?.default_branch
  if (fromRepo) return fromRepo
  const fromManifest = (manifest as { ci?: { defaultBranch?: unknown } } | null)?.ci?.defaultBranch
  if (typeof fromManifest === 'string' && BRANCH_RE.test(fromManifest)) return fromManifest
  return 'main'
}

const UNTRUSTED_REASON: Record<UntrustedKeyReason, string> = {
  browser_request: 'This push came from a web page, so it was not taken as the app\'s design state and cannot dispatch a fix. Push from CI with a key kept out of browser bundles.',
  key_seen_in_browser: 'This key has been sent by a web page, so anyone may hold it: the push keeps its findings and the CI gate, but does not set the shown score or dispatch a fix. Mint a separate key for CI and keep it out of browser bundles.',
  sdk_key: 'This is an SDK key (report:write only). It ships inside your app, so anyone may hold it: the push keeps its findings and the CI gate, but does not set the shown score or dispatch a fix. Push from CI with a CLI key (from `mushi login`, which adds mcp:read) kept in your CI secrets.',
}

export async function recordCiDeviance(db: Db, projectId: string, input: CiDevianceInput, deps: CiPushDeps = defaultCiPushDeps): Promise<CiDevianceResult> {
  const skipped = (reason: string): CiDevianceResult => ({ status: 'skipped', runId: null, score: null, clientScore: input.push.score ?? null, storedFindings: 0, droppedFindings: 0, gate: null, action: null, reason })
  const snapshot = await loadCurrentSnapshot(db, projectId)
  const set = judgingSet(snapshot?.tokens ?? null)
  if (!snapshot?.manifest || !set) return skipped('No design tokens to judge against, so the scan was not scored.')

  const rules = effectiveDesignRules(snapshot.manifest)
  const ctx = buildDevianceContext(set.tokens, rules, snapshot.manifest.design?.components?.globs ?? [])
  const literal: DevianceFinding[] = []
  let dropped = 0
  for (const f of input.push.findings) {
    const rule = ctx.rules.get(f.ruleId as DesignRuleId)
    const path = ciFilePath(f.filePath)
    const verdict = rule && path && LITERAL_RULES.includes(rule.id) ? rejudgeLiteral(path, rule.id, f.value, ctx) : null
    if (!rule || !path || !verdict) {
      dropped++
      continue
    }
    literal.push({ rule_id: rule.id, severity: rule.severity, file_path: path, line: f.line, col: f.col, value: verdict.value, message: verdict.message, suggestion: verdict.suggestion })
  }
  // The CLI lists every finding up to CLI_LISTED_MAX, so only past that may
  // its counts exceed what it listed. The test is on the findings accepted
  // here, so a listing padded with refused junk unlocks nothing.
  const listingFull = literal.length >= CLI_LISTED_MAX
  const counts: Partial<Record<DesignRuleId, number>> = {}
  for (const id of LITERAL_RULES) {
    if (!ctx.rules.get(id)?.enabled) continue
    const listed = literal.filter((f) => f.rule_id === id).length
    const n = listingFull ? Math.max(listed, Math.floor(input.push.counts[id] ?? 0)) : listed
    if (n > 0) counts[id] = n
  }
  const scored = scoreDeviance(snapshot, { counts, scannedLines: input.push.scannedLines, scannedFiles: input.push.scannedFiles })
  const findings = sortFindings([...literal, ...scored.contrastFindings])
  const status = devianceStatus(findings)
  const total = Object.values(scored.counts).reduce((a, b) => a + (b ?? 0), 0)
  const startedAt = deps.now().toISOString()
  // Only a trusted push of the default branch is the app's design state. Any
  // other branch (every PR run) and any push with a public key is stored as
  // its own phase, which never becomes the shown score, the metric or the
  // auto-fix baseline, and may never spend.
  const onDefault = input.branch === (await defaultBranchOf(db, projectId, snapshot.manifest))
  const exposure = input.keyExposure
  const trusted = exposure === null
  const phase = !onDefault ? CI_BRANCH_SCAN_PHASE : trusted ? DESIGN_SCAN_PHASE : CI_UNTRUSTED_SCAN_PHASE
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
  // The settings and the CI gate come first, so a failed findings insert still
  // fails a CI step the project asked to fail.
  const settings = await loadDesignActionSettings(db, projectId)
  const gate = settings.ok ? devianceGate(settings.settings, scored.score) : null
  const settingsReason = settings.ok ? null : `Design settings could not be read (${settings.error}); the CI gate was not applied.`

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
    return { status: 'error', runId, score: scored.score, clientScore, storedFindings: 0, droppedFindings: dropped, gate, action: null, reason: settingsReason ?? message }
  }

  let action: ActOutcome
  if (!onDefault) action = { action: 'not_default_branch' }
  else if (exposure) action = settings.ok && !settings.settings.autofix ? { action: 'off' } : { action: 'key_not_trusted', reason: exposure }
  else action = await deps.act(db, { projectId, runId, score: scored.score, findings, branch: input.branch }, settings)

  const completedAt = deps.now().toISOString()
  const summary = { ...base, storedFindings: stored, droppedFindings: dropped, ...(action.action === 'off' ? {} : { action }) }
  const { error: upErr } = await db.from('gate_runs').update({ status, summary, findings_count: total, completed_at: completedAt }).eq('id', runId)
  if (upErr) throw new Error(`gate_runs update failed: ${upErr.message}`)
  if (phase === DESIGN_SCAN_PHASE) await recordDevianceMetric(db, projectId, set.name, completedAt, scored.score)
  return {
    status,
    runId,
    score: scored.score,
    clientScore,
    storedFindings: stored,
    droppedFindings: dropped,
    gate,
    action,
    reason: settingsReason ?? (onDefault && exposure ? UNTRUSTED_REASON[exposure] : null),
  }
}
