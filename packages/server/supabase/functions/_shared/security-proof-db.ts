/**
 * FILE: packages/server/supabase/functions/_shared/security-proof-db.ts
 * PURPOSE: The security proof stage (Plan 025 P4, ADR 0074), database part:
 *          store one posted scanner result, file what it found as
 *          `security_scan` reports (deduped against vuln-watch and against
 *          open security_scan reports, capped per app per day), and read a
 *          release's Security proof.
 *
 * Reports are filed the way vuln-watch files known holes: fixed text,
 * status `classified`, confidence 1, no classification model call.
 */

import {
  computeProof,
  countSeverities,
  DEFAULT_SECURITY_DAILY_LIMIT,
  MAX_FINDINGS_PER_RUN,
  parseScanResult,
  planFindings,
  reportForFinding,
  securityPatternKey,
  TOOL_LANE,
  type OpenVulnRow,
  type PlannedFinding,
  type ScanFinding,
  type ScanRunRow,
  type SecurityProof,
  type SecurityTool,
} from './security-proof.ts'

// deno-lint-ignore no-explicit-any
type Db = { from: (table: string) => any }

/** Report statuses that still count as open (mirrors api/shared.ts OPEN_REPORT_STATUSES, plus fix in flight). */
const OPEN_STATUSES = ['new', 'queued', 'pending', 'submitted', 'classified', 'triaged', 'grouped', 'reopened', 'fixing', 'in_progress']

export class SecurityMigrationPending extends Error {
  constructor() {
    super('The security proof tables are not applied yet (migration 20261127140000_security_proof_release_kits).')
    this.name = 'SecurityMigrationPending'
  }
}

/** PostgREST / Postgres: the table or column this needs does not exist yet. */
export function securityTablesMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') return true
  const msg = error.message ?? ''
  return /security_scan_|commit_sha|release_kit/.test(msg) && /does not exist|schema cache/.test(msg)
}

export interface SecurityResultInput {
  tool: SecurityTool
  commitSha: string | null
  ref: string | null
  event: 'pull_request' | 'push' | 'schedule' | 'workflow_dispatch' | 'manual'
  prNumber: number | null
  runUrl: string | null
  targetUrl: string | null
  toolVersion: string | null
  startedAt: string | null
  /** Set by the workflow when the scan did not run or did not finish; otherwise derived from the findings. */
  status: 'error' | 'skipped' | null
  skipReason: string | null
  report: unknown
}

export interface SecurityIngestOutcome {
  runId: string
  lane: string
  status: 'passed' | 'findings' | 'error' | 'skipped'
  counts: Record<string, number>
  filed: Array<{ reportId: string; fingerprint: string; severity: string }>
  linked: Array<{ reportId: string; fingerprint: string; by: 'vuln_watch' | 'open_report' }>
  notFiled: number
  truncated: number
  warnings: string[]
}

function startOfUtcDay(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

async function openVulns(db: Db, projectId: string): Promise<OpenVulnRow[]> {
  const { data, error } = await db
    .from('dependency_vulns')
    .select('advisory_id, cve_ids, package_name, report_id')
    .eq('project_id', projectId)
    .eq('status', 'open')
    .limit(2000)
  // vuln-watch not applied or unreadable: no dedupe source, never a failure.
  if (error) return []
  return (data ?? []) as OpenVulnRow[]
}

async function openReportsByFingerprint(db: Db, projectId: string, fingerprints: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (fingerprints.length === 0) return out
  const keys = fingerprints.map(securityPatternKey)
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db
      .from('reports')
      .select('id, pattern_key')
      .eq('project_id', projectId)
      .eq('source', 'security_scan')
      .in('status', OPEN_STATUSES)
      .in('pattern_key', keys.slice(i, i + 200))
    for (const r of (data ?? []) as Array<{ id: string; pattern_key: string }>) {
      const fp = fingerprints.find((f) => securityPatternKey(f) === r.pattern_key)
      if (fp) out.set(fp, r.id)
    }
  }
  return out
}

async function dailyBudget(db: Db, projectId: string, now: Date): Promise<{ budget: number; limit: number }> {
  const [{ data: settings }, { count }] = await Promise.all([
    db.from('project_settings').select('security_reports_daily_limit').eq('project_id', projectId).maybeSingle(),
    db.from('reports').select('id', { count: 'exact', head: true }).eq('project_id', projectId).eq('source', 'security_scan').gte('created_at', startOfUtcDay(now)),
  ])
  const raw = (settings as { security_reports_daily_limit?: number } | null)?.security_reports_daily_limit
  const limit = typeof raw === 'number' ? raw : DEFAULT_SECURITY_DAILY_LIMIT
  return { budget: Math.max(0, limit - (count ?? 0)), limit }
}

/**
 * Store one posted result and file what it found. Throws
 * SecurityMigrationPending when the tables are not there yet, and an Error
 * with a plain reason when the report is not the tool's format.
 */
export async function ingestSecurityResult(db: Db, projectId: string, input: SecurityResultInput, now: Date): Promise<SecurityIngestOutcome> {
  const lane = TOOL_LANE[input.tool]
  const warnings: string[] = []
  let findings: ScanFinding[] = []
  if (input.status !== 'skipped' && input.status !== 'error') {
    findings = parseScanResult(input.tool, input.report)
  }
  const truncated = Math.max(0, findings.length - MAX_FINDINGS_PER_RUN)
  if (truncated > 0) warnings.push(`${truncated} more finding(s) were counted but not stored (limit ${MAX_FINDINGS_PER_RUN} a run).`)
  const counts = countSeverities(findings)
  const kept = findings.slice(0, MAX_FINDINGS_PER_RUN)

  let planned: PlannedFinding[] = []
  let limit = DEFAULT_SECURITY_DAILY_LIMIT
  if (kept.length > 0) {
    const [vulns, budget] = await Promise.all([lane === 'dependencies' ? openVulns(db, projectId) : Promise.resolve([]), dailyBudget(db, projectId, now)])
    limit = budget.limit
    // Fingerprints first, so open reports can be looked up in one pass.
    const preview = await planFindings(kept, { openVulns: vulns, openReportsByFingerprint: new Map(), budget: 0 })
    const open = await openReportsByFingerprint(db, projectId, preview.map((p) => p.fingerprint))
    planned = await planFindings(kept, { openVulns: vulns, openReportsByFingerprint: open, budget: budget.budget })
  }

  const status: SecurityIngestOutcome['status'] = input.status ?? (counts.total > 0 ? 'findings' : 'passed')
  const deduped = planned.filter((p) => p.dedupedBy === 'vuln_watch' || p.dedupedBy === 'open_report').length
  const { data: run, error: runErr } = await db.from('security_scan_runs').insert({
    project_id: projectId,
    lane,
    tool: input.tool,
    tool_version: input.toolVersion,
    commit_sha: input.commitSha,
    ref: input.ref,
    event: input.event,
    pr_number: input.prNumber,
    target_url: input.targetUrl,
    status,
    skip_reason: input.skipReason,
    counts: { ...counts, deduped, filed: 0 },
    run_url: input.runUrl,
    started_at: input.startedAt,
    finished_at: now.toISOString(),
  }).select('id').single()
  if (securityTablesMissing(runErr)) throw new SecurityMigrationPending()
  if (runErr || !run) throw new Error(`The scan run could not be stored: ${(runErr?.message ?? 'no row').slice(0, 160)}`)
  const runId = (run as { id: string }).id

  // File new reports (most severe first, as planned).
  const filed: SecurityIngestOutcome['filed'] = []
  const linked: SecurityIngestOutcome['linked'] = []
  const reportOf = new Map<string, string>()
  for (const p of planned) {
    if (p.linkReportId && (p.dedupedBy === 'vuln_watch' || p.dedupedBy === 'open_report')) {
      reportOf.set(p.fingerprint, p.linkReportId)
      linked.push({ reportId: p.linkReportId, fingerprint: p.fingerprint, by: p.dedupedBy })
    }
  }
  for (const p of planned.filter((x) => x.file)) {
    const r = reportForFinding(p, { commitSha: input.commitSha, runUrl: input.runUrl, ref: input.ref })
    const { data: report, error } = await db.from('reports').insert({
      project_id: projectId,
      source: 'security_scan',
      category: 'other',
      description: r.description,
      summary: r.summary,
      component: r.component,
      severity: r.severity,
      status: 'classified',
      confidence: 1,
      bug_ontology_tags: r.tags,
      pattern_key: r.pattern_key,
      reporter_token_hash: 'ci:mushi-security',
      environment: r.environment,
    }).select('id').maybeSingle()
    if (error?.code === '23505') {
      // Another post filed the same root cause first: link to it.
      const { data: existing } = await db.from('reports').select('id').eq('project_id', projectId).eq('source', 'security_scan').eq('pattern_key', r.pattern_key).in('status', OPEN_STATUSES).maybeSingle()
      const id = (existing as { id?: string } | null)?.id
      if (id) {
        reportOf.set(p.fingerprint, id)
        linked.push({ reportId: id, fingerprint: p.fingerprint, by: 'open_report' })
        p.dedupedBy = 'open_report'
      }
      continue
    }
    if (error || !report) {
      warnings.push(`A report for ${p.ruleId} was not filed: ${(error?.message ?? 'no row').slice(0, 120)}`)
      continue
    }
    const id = (report as { id: string }).id
    reportOf.set(p.fingerprint, id)
    filed.push({ reportId: id, fingerprint: p.fingerprint, severity: p.severity })
  }
  const capped = planned.filter((p) => p.dedupedBy === 'daily_limit').length
  if (capped > 0) warnings.push(`${capped} more report${capped === 1 ? '' : 's'} wait for tomorrow (limit ${limit} a day).`)

  // Store the findings (no snippets: only what security-proof.ts kept).
  const rows = planned.map((p) => ({
    run_id: runId,
    project_id: projectId,
    lane: p.lane,
    rule_id: p.ruleId,
    fingerprint: p.fingerprint,
    severity: p.severity,
    title: p.title,
    location: p.location,
    package_name: p.packageName,
    advisory_ids: p.advisoryIds.slice(0, 20),
    deduped_by: p.dedupedBy,
    report_id: reportOf.get(p.fingerprint) ?? null,
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('security_scan_findings').insert(rows.slice(i, i + 200))
    if (error) warnings.push(`Findings not stored: ${error.message.slice(0, 120)}`)
  }
  if (filed.length > 0) {
    await db.from('security_scan_runs').update({ counts: { ...counts, deduped, filed: filed.length } }).eq('id', runId)
  }
  return { runId, lane, status, counts: { ...counts, deduped, filed: filed.length }, filed, linked, notFiled: planned.filter((p) => !p.file && !p.linkReportId).length, truncated, warnings }
}

export interface ReleaseRef {
  id: string
  version: string
  status: string
  commit_sha: string | null
  published_at: string | null
  created_at: string
}

export interface ProofWithFindings extends SecurityProof {
  release: { id: string; version: string; commitSha: string | null } | null
  findings: Array<{ id: string; lane: string; severity: string; title: string; rule_id: string; location: Record<string, unknown>; report_id: string | null; deduped_by: string | null }>
}

/** Scan runs a proof can use: the project's last 200, newest first. */
async function recentRuns(db: Db, projectId: string): Promise<ScanRunRow[]> {
  const { data, error } = await db
    .from('security_scan_runs')
    .select('id, lane, tool, commit_sha, ref, event, status, skip_reason, counts, run_url, target_url, finished_at')
    .eq('project_id', projectId)
    .order('finished_at', { ascending: false })
    .limit(200)
  if (securityTablesMissing(error)) throw new SecurityMigrationPending()
  if (error) throw new Error(`Scan runs could not be read: ${error.message.slice(0, 160)}`)
  return (data ?? []) as ScanRunRow[]
}

/**
 * The Security proof of one release (or, with no release, of a commit or
 * the newest commit the scans saw), with the findings of the runs it used.
 */
export async function loadSecurityProof(db: Db, projectId: string, target: { release?: ReleaseRef | null; commitSha?: string | null }, now: Date): Promise<ProofWithFindings> {
  const runs = await recentRuns(db, projectId)
  const release = target.release ?? null
  const commitSha = release ? release.commit_sha : target.commitSha ?? runs.find((r) => r.commit_sha)?.commit_sha ?? null
  const at = release ? (release.published_at ?? null) : null
  const proof = computeProof(runs, { commitSha, at }, now)
  const runIds = proof.lanes.flatMap((l) => l.runs.map((r) => r.id))
  let findings: ProofWithFindings['findings'] = []
  if (runIds.length) {
    const { data } = await db
      .from('security_scan_findings')
      .select('id, lane, severity, title, rule_id, location, report_id, deduped_by')
      .in('run_id', runIds)
      .limit(300)
    findings = (data ?? []) as ProofWithFindings['findings']
  }
  return { ...proof, release: release ? { id: release.id, version: release.version, commitSha: release.commit_sha } : null, findings }
}
