/**
 * FILE: packages/server/supabase/functions/_shared/security-proof.ts
 * PURPOSE: The security proof stage (Plan 025 P4, ADR 0074), pure part.
 *
 *   The host's own CI runs the scanners (docs/templates/mushi-security.yml):
 *     dependencies  OSV-Scanner (Apache-2.0), SARIF, every PR
 *     secrets       Gitleaks (MIT), SARIF with --redact, every PR
 *     ai_review     anthropics/claude-code-security-review (MIT), its results
 *                   JSON, opt-in, trusted authors only, the host's own key
 *     dast          ZAP baseline (Apache-2.0) JSON + Nuclei (MIT) JSONL,
 *                   weekly against the app's staging URL
 *   and posts each result to POST /v1/security/results. Mushi parses it here,
 *   never runs a scanner and never hosts a scanner's rules (Semgrep registry
 *   rules and opengrep-rules forbid offering them as a service).
 *
 * Nothing here calls a model: findings become reports with fixed text, the
 * way vuln-watch files known holes (ADR 0038 decision 6).
 *
 * Never stored: a secret or a code snippet. Gitleaks runs with --redact, and
 * every text field is cut to a title and passed through redactText() anyway.
 */

export const SECURITY_LANES = ['dependencies', 'secrets', 'ai_review', 'dast'] as const
export type SecurityLane = (typeof SECURITY_LANES)[number]

export const SECURITY_TOOLS = ['osv-scanner', 'gitleaks', 'claude-code-security-review', 'zap-baseline', 'nuclei'] as const
export type SecurityTool = (typeof SECURITY_TOOLS)[number]

export const TOOL_LANE: Record<SecurityTool, SecurityLane> = {
  'osv-scanner': 'dependencies',
  gitleaks: 'secrets',
  'claude-code-security-review': 'ai_review',
  'zap-baseline': 'dast',
  nuclei: 'dast',
}

/** The format each tool posts. */
export const TOOL_FORMAT: Record<SecurityTool, 'sarif' | 'claude-review' | 'zap-json' | 'nuclei-jsonl'> = {
  'osv-scanner': 'sarif',
  gitleaks: 'sarif',
  'claude-code-security-review': 'claude-review',
  'zap-baseline': 'zap-json',
  nuclei: 'nuclei-jsonl',
}

export type ScanSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
const SEVERITY_ORDER: readonly ScanSeverity[] = ['info', 'low', 'medium', 'high', 'critical']
export const severityRank = (s: ScanSeverity): number => SEVERITY_ORDER.indexOf(s)

/** Findings at or above this are filed as reports; lower ones are recorded only. */
export const FILE_MIN_SEVERITY: ScanSeverity = 'medium'
/** Findings kept per run; the rest are counted, not stored. */
export const MAX_FINDINGS_PER_RUN = 500
/** Largest report body the ingest reads (SARIF of a big monorepo stays well under). */
export const MAX_RESULT_BYTES = 4 * 1024 * 1024
export const DEFAULT_SECURITY_DAILY_LIMIT = 10
/** DAST runs weekly, so a release's DAST lane is fresh when it ran this many days before the release. */
export const DAST_FRESH_DAYS = 8

export interface ScanFinding {
  lane: SecurityLane
  tool: SecurityTool
  ruleId: string
  severity: ScanSeverity
  title: string
  location: { file?: string; line?: number; url?: string }
  packageName: string | null
  packageVersion: string | null
  advisoryIds: string[]
}

// ── text hygiene ─────────────────────────────────────────────────────────────

// Long unbroken token runs (keys, JWTs, hex secrets). Paths and advisory ids
// (GHSA-xxxx-xxxx-xxxx, CVE-2026-12345) are broken by '/', '.' or short groups.
const TOKEN_RUN = /[A-Za-z0-9_+=-]{32,}/g
const JWT_LIKE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const KEY_PREFIXES = /\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|xox[abpr]|AKIA|ASIA|AIza|glpat|shpat|mushi)[-_][A-Za-z0-9_-]{8,}/g

/** Strip anything that looks like a credential, control characters and extra whitespace. */
export function redactText(input: string, max = 300): string {
  return input
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(JWT_LIKE, '[redacted]')
    .replace(KEY_PREFIXES, '[redacted]')
    .replace(TOKEN_RUN, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function firstLine(s: unknown, max = 300): string {
  if (typeof s !== 'string') return ''
  return redactText(s.split(/\r?\n/)[0] ?? '', max)
}

/** A repo-relative path from a SARIF uri (file:///github/workspace/x → x). Null for anything odd. */
export function cleanPath(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri) return null
  let p = uri.replace(/^file:\/\//, '')
  p = p.replace(/^\/(?:github\/workspace|home\/runner\/work\/[^/]+\/[^/]+|repo|src)\//, '')
  p = p.replace(/^\.\//, '').replace(/^\/+/, '')
  if (p.includes('..') || p.length > 400) return null
  return redactText(p, 400) || null
}

function cleanUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // Query strings can carry tokens; keep origin + path only.
    return redactText(`${url.origin}${url.pathname}`, 400)
  } catch {
    return null
  }
}

// ── severity ─────────────────────────────────────────────────────────────────

function fromCvss(score: number): ScanSeverity {
  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  if (score > 0) return 'low'
  return 'info'
}

function fromLabel(label: unknown): ScanSeverity | null {
  const l = String(label ?? '').toLowerCase()
  if (l === 'critical') return 'critical'
  if (l === 'high' || l === 'error') return 'high'
  if (l === 'medium' || l === 'moderate' || l === 'warning') return 'medium'
  if (l === 'low' || l === 'note') return 'low'
  if (l === 'info' || l === 'informational' || l === 'none' || l === 'unknown') return 'info'
  return null
}

// ── parsers ──────────────────────────────────────────────────────────────────

const ADVISORY_ID = /\b(?:GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d{4,7}|PYSEC-\d{4}-\d{1,7}|GO-\d{4}-\d{4,7}|RUSTSEC-\d{4}-\d{4}|OSV-\d{4}-\d{1,7})\b/gi

function advisoryIdsIn(...texts: unknown[]): string[] {
  const out = new Set<string>()
  for (const t of texts) {
    if (typeof t !== 'string') continue
    for (const m of t.matchAll(ADVISORY_ID)) out.add(m[0].toUpperCase().replace(/^GHSA/, 'GHSA'))
  }
  return [...out].map((id) => (id.startsWith('GHSA') ? `GHSA${id.slice(4).toLowerCase()}` : id))
}

interface SarifRule { id?: string; shortDescription?: { text?: string }; fullDescription?: { text?: string }; properties?: Record<string, unknown> }
interface SarifResult {
  ruleId?: string
  level?: string
  message?: { text?: string }
  locations?: Array<{ physicalLocation?: { artifactLocation?: { uri?: string }; region?: { startLine?: number } } }>
  properties?: Record<string, unknown>
}

/**
 * SARIF 2.1.0 → findings. Reads rule ids, levels, `security-severity`, the
 * first location and the message's first line; never a snippet, region text
 * or fingerprint value the tool attached.
 */
export function parseSarif(sarif: unknown, tool: 'osv-scanner' | 'gitleaks'): ScanFinding[] {
  const runs = (sarif as { runs?: unknown } | null)?.runs
  if (!Array.isArray(runs)) throw new Error('Not a SARIF log: no runs[]')
  const lane = TOOL_LANE[tool]
  const out: ScanFinding[] = []
  for (const run of runs as Array<{ tool?: { driver?: { rules?: SarifRule[] } }; results?: SarifResult[] }>) {
    const rules = new Map<string, SarifRule>()
    for (const r of run.tool?.driver?.rules ?? []) if (r?.id) rules.set(r.id, r)
    for (const res of run.results ?? []) {
      const ruleId = firstLine(res.ruleId, 200)
      if (!ruleId) continue
      const rule = rules.get(res.ruleId ?? '')
      const msg = typeof res.message?.text === 'string' ? res.message.text : ''
      const loc = res.locations?.[0]?.physicalLocation
      const file = cleanPath(loc?.artifactLocation?.uri)
      const line = typeof loc?.region?.startLine === 'number' && loc.region.startLine > 0 ? Math.floor(loc.region.startLine) : undefined
      let severity: ScanSeverity
      const secSev = Number(rule?.properties?.['security-severity'] ?? res.properties?.['security-severity'])
      if (tool === 'gitleaks') severity = 'high'
      else if (Number.isFinite(secSev) && secSev > 0) severity = fromCvss(secSev)
      else severity = fromLabel(res.level) ?? 'medium'
      let packageName: string | null = null
      let packageVersion: string | null = null
      let advisoryIds: string[] = []
      let title: string
      if (tool === 'osv-scanner') {
        // "Package 'lodash@4.17.20' is vulnerable to 'GHSA-…' (also known as 'CVE-…')."
        const m = /Package '((?:@[^/'\s]+\/)?[^@'\s]+)@([^'\s]+)'/.exec(msg)
        packageName = m?.[1] ? redactText(m[1], 300) : null
        packageVersion = m?.[2] ? redactText(m[2], 100) : null
        advisoryIds = advisoryIdsIn(ruleId, msg, rule?.shortDescription?.text)
        const summary = firstLine(rule?.shortDescription?.text, 200).replace(/^[A-Z]+-[\w-]+:\s*/, '')
        title = packageName ? `${packageName}${packageVersion ? ` ${packageVersion}` : ''}: ${summary || ruleId}` : (summary || ruleId)
      } else {
        // Gitleaks: the rule names the kind of secret; the message names the file. Never the match.
        title = `Possible ${ruleId.replace(/[-_]+/g, ' ')} committed${file ? ` in ${file}` : ''}`
      }
      out.push({ lane, tool, ruleId, severity, title: redactText(title, 300), location: { ...(file ? { file } : {}), ...(line ? { line } : {}) }, packageName, packageVersion, advisoryIds })
    }
  }
  return out
}

/** claude-code-security-review's results JSON: { findings: [{ file, line, severity, category, description }] }. */
export function parseClaudeReview(json: unknown): ScanFinding[] {
  const findings = (json as { findings?: unknown } | null)?.findings
  if (!Array.isArray(findings)) {
    if ((json as { error?: unknown } | null)?.error) throw new Error('The AI review reported an error instead of findings')
    throw new Error('Not a claude-code-security-review result: no findings[]')
  }
  return (findings as Array<Record<string, unknown>>).flatMap((f) => {
    const category = firstLine(f.category, 120) || 'security_issue'
    const file = cleanPath(f.file)
    const line = typeof f.line === 'number' && f.line > 0 ? Math.floor(f.line) : undefined
    const desc = firstLine(f.description, 240)
    return [{
      lane: 'ai_review' as const,
      tool: 'claude-code-security-review' as const,
      ruleId: category,
      severity: fromLabel(f.severity) ?? 'medium',
      title: redactText(`${category.replace(/_/g, ' ')}${file ? ` in ${file}` : ''}${desc ? `: ${desc}` : ''}`, 300),
      location: { ...(file ? { file } : {}), ...(line ? { line } : {}) },
      packageName: null,
      packageVersion: null,
      advisoryIds: [],
    }]
  })
}

const ZAP_RISK: Record<string, ScanSeverity> = { '0': 'info', '1': 'low', '2': 'medium', '3': 'high' }

/** ZAP baseline's JSON report (-J): site[].alerts[] with riskcode and instances[].uri. */
export function parseZap(json: unknown): ScanFinding[] {
  const sites = (json as { site?: unknown } | null)?.site
  if (!Array.isArray(sites)) throw new Error('Not a ZAP JSON report: no site[]')
  const out: ScanFinding[] = []
  for (const site of sites as Array<{ alerts?: Array<Record<string, unknown>>; '@name'?: string }>) {
    for (const a of site.alerts ?? []) {
      const ruleId = firstLine(a.alertRef ?? a.pluginid, 60)
      if (!ruleId) continue
      const instances = Array.isArray(a.instances) ? (a.instances as Array<{ uri?: string }>) : []
      const url = cleanUrl(instances[0]?.uri) ?? cleanUrl(site['@name'])
      out.push({
        lane: 'dast', tool: 'zap-baseline', ruleId: `zap-${ruleId}`,
        severity: ZAP_RISK[String(a.riskcode ?? '')] ?? 'info',
        title: redactText(`${firstLine(a.alert ?? a.name, 200) || `ZAP rule ${ruleId}`}${url ? ` on ${url}` : ''}`, 300),
        location: url ? { url } : {},
        packageName: null, packageVersion: null,
        advisoryIds: advisoryIdsIn(a.reference),
      })
    }
  }
  return out
}

/** Nuclei's JSONL export (-jsonl): one object per line with template-id, info.severity, matched-at. */
export function parseNuclei(input: unknown): ScanFinding[] {
  const rows: unknown[] = typeof input === 'string'
    ? input.split(/\r?\n/).filter((l) => l.trim()).map((l) => { try { return JSON.parse(l) } catch { return null } })
    : Array.isArray(input) ? input : []
  return rows.flatMap((r) => {
    const row = r as Record<string, unknown> | null
    const ruleId = firstLine(row?.['template-id'] ?? row?.templateID, 120)
    if (!row || !ruleId) return []
    const info = (row.info ?? {}) as Record<string, unknown>
    const url = cleanUrl(row['matched-at'] ?? row.matched ?? row.host)
    const classification = (info.classification ?? {}) as Record<string, unknown>
    return [{
      lane: 'dast' as const, tool: 'nuclei' as const, ruleId: `nuclei-${ruleId}`,
      severity: fromLabel(info.severity) ?? 'info',
      title: redactText(`${firstLine(info.name, 200) || ruleId}${url ? ` on ${url}` : ''}`, 300),
      location: url ? { url } : {},
      packageName: null, packageVersion: null,
      advisoryIds: advisoryIdsIn(JSON.stringify(classification['cve-id'] ?? '')),
    }]
  })
}

/** Parse one posted result by its tool. Throws with a plain reason on a body that is not that tool's format. */
export function parseScanResult(tool: SecurityTool, report: unknown): ScanFinding[] {
  switch (tool) {
    case 'osv-scanner':
    case 'gitleaks':
      return parseSarif(typeof report === 'string' ? JSON.parse(report) : report, tool)
    case 'claude-code-security-review':
      return parseClaudeReview(typeof report === 'string' ? JSON.parse(report) : report)
    case 'zap-baseline':
      return parseZap(typeof report === 'string' ? JSON.parse(report) : report)
    case 'nuclei':
      return parseNuclei(report)
  }
}

// ── identity and dedupe ──────────────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * One root cause across runs and commits: a dependency advisory is the
 * (package, advisory) pair wherever the lockfile sits; a secret or an AI
 * finding is (rule, file); a DAST finding is (rule, URL path). Line numbers
 * move with every edit, so they are not part of it.
 */
export function fingerprintKey(f: Pick<ScanFinding, 'lane' | 'ruleId' | 'location' | 'packageName'>): string {
  if (f.lane === 'dependencies') return `${f.lane}|${f.ruleId.toUpperCase()}|${(f.packageName ?? '').toLowerCase()}`
  if (f.lane === 'dast') return `${f.lane}|${f.ruleId}|${f.location.url ? new URL(f.location.url).pathname : ''}`
  return `${f.lane}|${f.ruleId}|${f.location.file ?? ''}`
}

export const fingerprintOf = (f: Pick<ScanFinding, 'lane' | 'ruleId' | 'location' | 'packageName'>): Promise<string> => sha256(fingerprintKey(f))

/** One open dependency_vulns row, as vuln-watch stores it. */
export interface OpenVulnRow {
  advisory_id: string
  cve_ids: string[] | null
  package_name: string
  report_id: string | null
}

/**
 * The vuln-watch row that already tracks this dependency finding: same
 * package, and one advisory id or CVE in common. Null for other lanes or no
 * overlap. vuln-watch reads the lockfiles itself, so the CI finding links to
 * its report instead of filing a second one (ADR 0074 decision 4).
 */
export function matchVulnWatch(f: ScanFinding, open: readonly OpenVulnRow[]): OpenVulnRow | null {
  if (f.lane !== 'dependencies' || f.advisoryIds.length === 0) return null
  const ids = new Set(f.advisoryIds.map((x) => x.toUpperCase()))
  const pkg = (f.packageName ?? '').toLowerCase()
  for (const row of open) {
    if (pkg && row.package_name.toLowerCase() !== pkg) continue
    const theirs = [row.advisory_id, ...(row.cve_ids ?? [])].map((x) => x.toUpperCase())
    if (theirs.some((x) => ids.has(x))) return row
  }
  return null
}

export interface PlannedFinding extends ScanFinding {
  fingerprint: string
  dedupedBy: 'vuln_watch' | 'open_report' | 'daily_limit' | 'below_threshold' | null
  /** The existing report this finding links to (vuln-watch's or an open security_scan one). */
  linkReportId: string | null
  /** True when this finding should get a new report. */
  file: boolean
}

/**
 * Decide, per finding, whether it files a new report: one per fingerprint,
 * not when vuln-watch or an open security_scan report already has it, only
 * at FILE_MIN_SEVERITY or above, and within the app's daily budget (most
 * severe first).
 */
export async function planFindings(
  findings: readonly ScanFinding[],
  input: { openVulns: readonly OpenVulnRow[]; openReportsByFingerprint: ReadonlyMap<string, string>; budget: number },
): Promise<PlannedFinding[]> {
  const seen = new Set<string>()
  const planned: PlannedFinding[] = []
  for (const f of findings) {
    const fingerprint = await fingerprintOf(f)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    const vw = matchVulnWatch(f, input.openVulns)
    const open = input.openReportsByFingerprint.get(fingerprint) ?? null
    let dedupedBy: PlannedFinding['dedupedBy'] = null
    let linkReportId: string | null = null
    if (vw) { dedupedBy = 'vuln_watch'; linkReportId = vw.report_id }
    else if (open) { dedupedBy = 'open_report'; linkReportId = open }
    else if (severityRank(f.severity) < severityRank(FILE_MIN_SEVERITY)) dedupedBy = 'below_threshold'
    planned.push({ ...f, fingerprint, dedupedBy, linkReportId, file: dedupedBy === null })
  }
  // Spend the budget on the most severe first.
  let budget = Math.max(0, input.budget)
  for (const p of [...planned].filter((x) => x.file).sort((a, b) => severityRank(b.severity) - severityRank(a.severity))) {
    if (budget > 0) { budget--; continue }
    p.file = false
    p.dedupedBy = 'daily_limit'
  }
  return planned
}

export function countSeverities(findings: readonly Pick<ScanFinding, 'severity'>[]): Record<ScanSeverity | 'total', number> {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 }
  for (const f of findings) { c[f.severity]++; c.total++ }
  return c
}

// ── the report ───────────────────────────────────────────────────────────────

export const securityPatternKey = (fingerprint: string): string => `security_scan:${fingerprint.slice(0, 40)}`

const LANE_LABEL: Record<SecurityLane, string> = {
  dependencies: 'Dependency scan (OSV-Scanner)',
  secrets: 'Secret scan (Gitleaks)',
  ai_review: 'AI security review (claude-code-security-review)',
  dast: 'Live-site scan (ZAP baseline / Nuclei)',
}

const LANE_FIX: Record<SecurityLane, string[]> = {
  dependencies: [
    'Upgrade the package to a version the advisory lists as fixed, through the package manager (never edit a lockfile by hand).',
    'Run the app\'s tests and build.',
  ],
  secrets: [
    'Treat the secret as leaked: rotate or revoke it at the provider first. Deleting it from the repo, or from git history, does not un-leak it.',
    'Move the value to the host\'s secret store or an environment variable that is not committed, and read it from there.',
    'If it is a false positive (a test fixture, a public key), add it to .gitleaksignore with a comment saying why.',
  ],
  ai_review: [
    'Read the finding in the PR\'s review comment and confirm it against the code; the AI review can be wrong.',
    'Fix the code path it names and add a test that fails without the fix.',
  ],
  dast: [
    'Reproduce the finding on the staging URL named above.',
    'Fix the response (header, cookie flag, exposed path) in the app or its hosting config, and redeploy staging.',
  ],
}

export interface SecurityReportRow {
  summary: string
  description: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  component: string
  tags: string[]
  pattern_key: string
  environment: Record<string, unknown>
}

/** The plain-English report for one finding. No model call. */
export function reportForFinding(f: PlannedFinding, run: { commitSha: string | null; runUrl: string | null; ref: string | null }): SecurityReportRow {
  const where = f.location.file ? `${f.location.file}${f.location.line ? `:${f.location.line}` : ''}` : f.location.url ?? null
  const lines: string[] = [
    `${LANE_LABEL[f.lane]} found: ${f.title}.`,
    '',
    `Rule: ${f.ruleId}${f.advisoryIds.length ? ` (${f.advisoryIds.slice(0, 5).join(', ')})` : ''}.`,
    ...(where ? [`Where: ${where}.`] : []),
    `Severity: ${f.severity}.`,
    '',
    'How to fix:',
    ...LANE_FIX[f.lane].map((s, i) => `${i + 1}. ${s}`),
    '',
    'Do not write exploit or proof-of-concept code for this finding. A test that the fixed behaviour holds is enough.',
    '',
    `Found by your own CI (mushi-security.yml${run.ref ? ` on ${run.ref}` : ''}${run.commitSha ? ` at ${run.commitSha.slice(0, 7)}` : ''}).${run.runUrl ? ` Run: ${run.runUrl}` : ''}`,
  ]
  return {
    summary: redactText(`Security: ${f.title}`, 200),
    description: lines.join('\n').slice(0, 8000),
    severity: f.severity === 'info' ? 'low' : f.severity,
    component: f.packageName ?? f.location.file ?? (f.location.url ? new URL(f.location.url).host : f.lane),
    tags: ['security_scan', f.lane, f.tool, f.ruleId.slice(0, 80), ...f.advisoryIds.slice(0, 3)],
    pattern_key: securityPatternKey(f.fingerprint),
    environment: {
      source: 'security-scan',
      lane: f.lane,
      tool: f.tool,
      ruleId: f.ruleId,
      fingerprint: f.fingerprint,
      location: f.location,
      package: f.packageName,
      advisories: f.advisoryIds,
      commitSha: run.commitSha,
      runUrl: run.runUrl,
    },
  }
}

// ── the proof ────────────────────────────────────────────────────────────────

export interface ScanRunRow {
  id: string
  lane: SecurityLane
  tool: SecurityTool
  commit_sha: string | null
  ref: string | null
  event: string
  status: 'passed' | 'findings' | 'error' | 'skipped'
  skip_reason: string | null
  counts: Partial<Record<ScanSeverity | 'total' | 'deduped' | 'filed', number>>
  run_url: string | null
  target_url: string | null
  finished_at: string
}

export type LaneState = 'passed' | 'findings' | 'error' | 'skipped' | 'off' | 'unknown' | 'stale'
export type LaneTone = 'ok' | 'warn' | 'danger' | 'neutral'

export interface LaneProof {
  lane: SecurityLane
  label: string
  required: boolean
  state: LaneState
  tone: LaneTone
  /** What a person reads next to the lane. */
  detail: string
  run: ScanRunRow | null
  counts: Record<ScanSeverity | 'total', number>
  /** Every tool run that counts for this lane (DAST: ZAP and Nuclei). */
  runs: ScanRunRow[]
}

export type ProofState = 'proven' | 'attention' | 'incomplete' | 'not_pinned'

export interface SecurityProof {
  state: ProofState
  headline: string
  commitSha: string | null
  lanes: LaneProof[]
}

const LANE_SHORT: Record<SecurityLane, string> = { dependencies: 'Dependencies', secrets: 'Secrets', ai_review: 'AI review', dast: 'Live site (DAST)' }
const REQUIRED: Record<SecurityLane, boolean> = { dependencies: true, secrets: true, ai_review: false, dast: false }

/** Two SHAs name the same commit when one is a prefix of the other (7–40 hex). */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x))
}

function emptyCounts(): Record<ScanSeverity | 'total', number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: 0 }
}

function laneFromRuns(lane: SecurityLane, runs: ScanRunRow[], everRan: boolean, stale: boolean): LaneProof {
  const required = REQUIRED[lane]
  const counts = emptyCounts()
  for (const r of runs) for (const k of Object.keys(counts) as Array<keyof typeof counts>) counts[k] += Number(r.counts?.[k] ?? 0)
  const latest = runs[0] ?? null
  const base = { lane, label: LANE_SHORT[lane], required, run: latest, counts, runs }
  if (!latest) {
    if (!required && !everRan) {
      return { ...base, state: 'off', tone: 'neutral', detail: lane === 'ai_review' ? 'Off. Opt in with the MUSHI_SECURITY_AI_REVIEW repo variable; it runs on trusted authors\' PRs only.' : 'Not set up. Set the MUSHI_STAGING_URL repo variable to scan the staging site weekly.' }
    }
    return { ...base, state: 'unknown', tone: required ? 'danger' : 'neutral', detail: required ? 'No scan for this commit yet. A lane that never ran is not a pass.' : 'No run for this commit.' }
  }
  if (stale) return { ...base, state: 'stale', tone: 'warn', detail: `Last ran ${latest.finished_at.slice(0, 10)}, older than ${DAST_FRESH_DAYS} days before this release.` }
  if (runs.some((r) => r.status === 'error')) return { ...base, state: 'error', tone: required ? 'danger' : 'warn', detail: 'The scan did not finish. Re-run it from the Actions tab.' }
  if (runs.every((r) => r.status === 'skipped')) {
    return { ...base, state: 'skipped', tone: required ? 'danger' : 'neutral', detail: latest.skip_reason ?? 'Skipped: not configured.' }
  }
  if (counts.total === 0) return { ...base, state: 'passed', tone: 'ok', detail: 'Clean.' }
  const blocking = counts.critical + counts.high
  return {
    ...base,
    state: 'findings',
    tone: blocking > 0 ? 'danger' : 'warn',
    detail: `${counts.total} finding${counts.total === 1 ? '' : 's'}${blocking ? `, ${blocking} critical or high` : ''}.`,
  }
}

/**
 * A release's Security proof: per lane, the scans for its commit (DAST: the
 * newest weekly run within DAST_FRESH_DAYS before it). Honest by
 * construction (ADR 0017 consequences): a lane that never ran is `unknown`,
 * never green; a release without a commit is `not_pinned`.
 *
 *   proven      dependencies and secrets passed for this commit, and no
 *               enabled lane has findings or errors
 *   attention   a lane has findings, or an optional lane errored / is stale
 *   incomplete  a required lane is missing, errored or skipped
 *   not_pinned  the release names no commit
 */
export function computeProof(runs: readonly ScanRunRow[], release: { commitSha: string | null; at: string | null }, now: Date): SecurityProof {
  const sorted = [...runs].sort((a, b) => b.finished_at.localeCompare(a.finished_at))
  const at = release.at ? Date.parse(release.at) : now.getTime()
  const lanes: LaneProof[] = SECURITY_LANES.map((lane) => {
    const ofLane = sorted.filter((r) => r.lane === lane)
    const everRan = ofLane.some((r) => r.status !== 'skipped')
    if (lane === 'dast') {
      const before = ofLane.filter((r) => Date.parse(r.finished_at) <= at + 60_000)
      const newestDay = before[0]?.finished_at.slice(0, 10)
      // ZAP and Nuclei post separately: take each tool's newest run of that week.
      const latestPerTool = new Map<string, ScanRunRow>()
      for (const r of before) if (!latestPerTool.has(r.tool)) latestPerTool.set(r.tool, r)
      const picked = [...latestPerTool.values()].filter((r) => at - Date.parse(r.finished_at) <= DAST_FRESH_DAYS * 86_400_000 + 60_000)
      const stale = picked.length === 0 && !!newestDay
      return laneFromRuns(lane, stale ? [before[0]] : picked, everRan, stale)
    }
    if (!release.commitSha) return laneFromRuns(lane, [], everRan, false)
    const forCommit = ofLane.filter((r) => sameCommit(r.commit_sha, release.commitSha))
    return laneFromRuns(lane, forCommit.slice(0, 1), everRan, false)
  })
  if (!release.commitSha) {
    return {
      state: 'not_pinned',
      headline: 'Not pinned to a commit. Set the release\'s commit so its scans can prove it.',
      commitSha: null,
      lanes: lanes.map((l) => (l.lane === 'dast' ? l : { ...l, state: 'unknown' as const, tone: 'neutral' as const, detail: 'Needs the release commit.' })),
    }
  }
  const required = lanes.filter((l) => l.required)
  const optional = lanes.filter((l) => !l.required)
  let state: ProofState
  if (required.some((l) => l.state !== 'passed' && l.state !== 'findings')) state = 'incomplete'
  else if (lanes.some((l) => l.state === 'findings') || optional.some((l) => l.state === 'error' || l.state === 'stale' || l.state === 'unknown')) state = 'attention'
  else state = 'proven'
  const short = release.commitSha.slice(0, 7)
  const headline = state === 'proven'
    ? `Security proof: scans green for ${short}.`
    : state === 'attention'
      ? `Scans ran for ${short}, with something to look at.`
      : `Not proven yet: ${required.filter((l) => l.state !== 'passed' && l.state !== 'findings').map((l) => l.label.toLowerCase()).join(' and ')} ${required.filter((l) => l.state !== 'passed' && l.state !== 'findings').length === 1 ? 'has' : 'have'} no result for ${short}.`
  return { state, headline, commitSha: release.commitSha, lanes }
}
