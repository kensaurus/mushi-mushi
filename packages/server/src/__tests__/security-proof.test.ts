/**
 * Plan 025 P4 / ADR 0074: the security proof stage. The workflow template
 * copy, the SARIF / JSON parsers (never a secret or snippet kept), dedupe
 * against vuln-watch and open reports, the daily cap, the per-release proof
 * (a lane that never ran is never green), and the ingest against a fake DB.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFakeDb } from './__stubs__/fake-supabase.ts'
import {
  computeProof,
  fingerprintOf,
  matchVulnWatch,
  parseClaudeReview,
  parseNuclei,
  parseSarif,
  parseZap,
  planFindings,
  redactText,
  reportForFinding,
  sameCommit,
  securityPatternKey,
  type ScanFinding,
  type ScanRunRow,
} from '../../supabase/functions/_shared/security-proof.ts'
import { ingestSecurityResult, loadSecurityProof } from '../../supabase/functions/_shared/security-proof-db.ts'
import { fillSecurityWorkflow, SECURITY_WORKFLOW_TEMPLATE } from '../../supabase/functions/_shared/security-workflow.ts'
import { ciReportFor } from '../../supabase/functions/_shared/vuln-watch-db.ts'

const ROOT = resolve(__dirname, '../../../..')
const P = '1000000a-0000-4000-8000-000000000000'
const NOW = new Date('2026-11-27T12:00:00Z')
const SHA = 'abcdef1234567890abcdef1234567890abcdef12'
const FAKE_KEY = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'

const osvSarif = {
  runs: [{
    tool: { driver: { name: 'osv-scanner', rules: [{ id: 'GHSA-jf85-cpcp-j695', shortDescription: { text: 'GHSA-jf85-cpcp-j695: Prototype Pollution in lodash' }, properties: { 'security-severity': '9.1' } }] } },
    results: [{
      ruleId: 'GHSA-jf85-cpcp-j695',
      level: 'warning',
      message: { text: "Package 'lodash@4.17.11' is vulnerable to 'GHSA-jf85-cpcp-j695' (also known as 'CVE-2019-10744')." },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'file:///github/workspace/package-lock.json' }, region: { startLine: 3, snippet: { text: 'secret-ish' } } } }],
    }],
  }],
}

const gitleaksSarif = {
  runs: [{
    tool: { driver: { name: 'gitleaks', rules: [{ id: 'github-pat' }] } },
    results: [{
      ruleId: 'github-pat',
      message: { text: `github-pat has detected secret for file src/config.ts: ${FAKE_KEY}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/config.ts' }, region: { startLine: 12, snippet: { text: FAKE_KEY } } } }],
    }],
  }],
}

function run(partial: Partial<ScanRunRow> & Pick<ScanRunRow, 'lane' | 'tool'>): ScanRunRow {
  return { id: crypto.randomUUID(), commit_sha: SHA, ref: 'main', event: 'workflow_dispatch', status: 'passed', skip_reason: null, counts: {}, run_url: null, target_url: null, finished_at: '2026-11-26T10:00:00Z', ...partial }
}

describe('workflow template', () => {
  it('equals docs/templates/mushi-security.yml byte for byte', () => {
    const template = readFileSync(resolve(ROOT, 'docs/templates/mushi-security.yml'), 'utf8').replace(/\r\n/g, '\n')
    expect(SECURITY_WORKFLOW_TEMPLATE).toBe(template)
  })

  it('follows the CI cost rules: concurrency, job timeouts, weekly DAST, no pull_request_target', () => {
    const t = SECURITY_WORKFLOW_TEMPLATE
    expect(t).toMatch(/^concurrency:\n {2}group: mushi-security-/m)
    expect((t.match(/timeout-minutes: \d+/g) ?? []).length).toBe(3)
    expect(t).toContain("cron: '17 3 * * 1'")
    // Triggers: pull_request, workflow_dispatch, schedule. Never pull_request_target.
    const on = t.split('\non:\n')[1].split('\npermissions:')[0]
    expect(on).toMatch(/^ {2}pull_request:$/m)
    expect(on).not.toMatch(/pull_request_target:/)
    expect(on).not.toMatch(/^ {2}push:/m)
    expect(t).not.toMatch(/upload-artifact/)
    // Trusted authors only, same-repo PRs only, opt-in.
    expect(t).toContain("vars.MUSHI_SECURITY_AI_REVIEW == 'true'")
    expect(t).toContain('github.event.pull_request.head.repo.full_name == github.repository')
    // Gitleaks never prints a secret.
    expect(t).toContain('--redact')
    // Every third-party action is pinned to a commit.
    for (const m of t.matchAll(/uses: ([^\s]+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/)
  })

  it('fills the endpoint and the deployment\'s fix-agent bot, and leaves the hosted default otherwise', () => {
    expect(fillSecurityWorkflow()).toBe(SECURITY_WORKFLOW_TEMPLATE)
    const filled = fillSecurityWorkflow({ apiEndpoint: 'https://mushi.example.com/functions/v1/api/', trustedBots: ['my-mushi[bot]', 'not a login'] })
    expect(filled).toContain("vars.MUSHI_API_ENDPOINT || 'https://mushi.example.com/functions/v1/api'")
    expect(filled).toContain("format('{0},my-mushi[bot]', github.repository_owner)")
    expect(filled).not.toContain('not a login')
  })
})

describe('parsers keep no secret and no snippet', () => {
  it('reads OSV-Scanner SARIF: package, version, advisories, CVSS severity', () => {
    const [f] = parseSarif(osvSarif, 'osv-scanner')
    expect(f).toMatchObject({ lane: 'dependencies', ruleId: 'GHSA-jf85-cpcp-j695', severity: 'critical', packageName: 'lodash', packageVersion: '4.17.11', location: { file: 'package-lock.json', line: 3 } })
    expect(f.advisoryIds).toEqual(expect.arrayContaining(['GHSA-jf85-cpcp-j695', 'CVE-2019-10744']))
    expect(JSON.stringify(f)).not.toContain('secret-ish')
  })

  it('reads Gitleaks SARIF without the matched secret', () => {
    const [f] = parseSarif(gitleaksSarif, 'gitleaks')
    expect(f).toMatchObject({ lane: 'secrets', severity: 'high', ruleId: 'github-pat', location: { file: 'src/config.ts', line: 12 } })
    expect(JSON.stringify(f)).not.toContain(FAKE_KEY)
    expect(f.title).toBe('Possible github pat committed in src/config.ts')
  })

  it('redacts token-shaped text anywhere', () => {
    expect(redactText(`key ${FAKE_KEY} and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl ok`)).toBe('key [redacted] and [redacted] ok')
    expect(redactText('GHSA-jf85-cpcp-j695 in src/components/very/long/path/name.tsx')).toBe('GHSA-jf85-cpcp-j695 in src/components/very/long/path/name.tsx')
  })

  it('reads the AI review, ZAP and Nuclei formats', () => {
    expect(parseClaudeReview({ findings: [{ file: 'api/users.py', line: 42, severity: 'HIGH', category: 'sql_injection', description: 'User input in SQL' }] })[0])
      .toMatchObject({ lane: 'ai_review', severity: 'high', ruleId: 'sql_injection', location: { file: 'api/users.py', line: 42 } })
    expect(() => parseClaudeReview({ error: 'boom' })).toThrow(/reported an error/)
    expect(parseZap({ site: [{ '@name': 'https://staging.example.com', alerts: [{ pluginid: '10038', alertRef: '10038-1', alert: 'Content Security Policy Header Not Set', riskcode: '2', instances: [{ uri: 'https://staging.example.com/login?token=abc' }] }] }] })[0])
      .toMatchObject({ lane: 'dast', severity: 'medium', ruleId: 'zap-10038-1', location: { url: 'https://staging.example.com/login' } })
    const nuclei = parseNuclei('{"template-id":"exposed-env","info":{"name":"Exposed .env","severity":"high"},"matched-at":"https://staging.example.com/.env"}\n\nnot json\n')
    expect(nuclei).toHaveLength(1)
    expect(nuclei[0]).toMatchObject({ severity: 'high', ruleId: 'nuclei-exposed-env' })
    expect(() => parseSarif({}, 'osv-scanner')).toThrow(/Not a SARIF/)
  })
})

describe('dedupe and the filing plan', () => {
  const dep: ScanFinding = parseSarif(osvSarif, 'osv-scanner')[0]
  const secret: ScanFinding = parseSarif(gitleaksSarif, 'gitleaks')[0]
  const low: ScanFinding = { ...secret, lane: 'dast', tool: 'zap-baseline', ruleId: 'zap-1', severity: 'low', location: { url: 'https://s.example.com/' } }

  it('links a dependency finding to the vuln-watch row with the same package and advisory', () => {
    const row = { advisory_id: 'GHSA-JF85-CPCP-J695', cve_ids: [], package_name: 'lodash', report_id: 'r-vw' }
    expect(matchVulnWatch(dep, [row])).toBe(row)
    expect(matchVulnWatch(dep, [{ ...row, package_name: 'underscore' }])).toBeNull()
    expect(matchVulnWatch(secret, [row])).toBeNull()
  })

  it('files one report per fingerprint, most severe first, within the budget', async () => {
    const open = new Map([[await fingerprintOf(secret), 'r-open']])
    const plan = await planFindings([dep, dep, secret, low], { openVulns: [], openReportsByFingerprint: open, budget: 1 })
    expect(plan).toHaveLength(3)
    expect(plan.find((p) => p.lane === 'dependencies')).toMatchObject({ file: true, dedupedBy: null })
    expect(plan.find((p) => p.lane === 'secrets')).toMatchObject({ file: false, dedupedBy: 'open_report', linkReportId: 'r-open' })
    expect(plan.find((p) => p.lane === 'dast')).toMatchObject({ file: false, dedupedBy: 'below_threshold' })
    const capped = await planFindings([dep, secret], { openVulns: [], openReportsByFingerprint: new Map(), budget: 1 })
    expect(capped.find((p) => p.lane === 'dependencies')?.file).toBe(true)
    expect(capped.find((p) => p.lane === 'secrets')).toMatchObject({ file: false, dedupedBy: 'daily_limit' })
  })

  it('writes a fixed-text report that never asks for exploit code', async () => {
    const [p] = await planFindings([secret], { openVulns: [], openReportsByFingerprint: new Map(), budget: 5 })
    const r = reportForFinding(p, { commitSha: SHA, runUrl: 'https://github.com/o/r/actions/runs/1', ref: 'main' })
    expect(r.pattern_key).toBe(securityPatternKey(p.fingerprint))
    expect(r.description).toMatch(/rotate or revoke it/)
    expect(r.description).toMatch(/Do not write exploit/)
    expect(r.description).not.toContain(FAKE_KEY)
    expect(r.tags[0]).toBe('security_scan')
  })

  it('vuln-watch links its group to an open CI report instead of filing twice', () => {
    const group = { kind: 'package' as const, name: 'lodash', matches: [{ advisoryId: 'GHSA-jf85-cpcp-j695', cveIds: ['CVE-2019-10744'] }] }
    expect(ciReportFor(group as never, [{ reportId: 'r-ci', packageName: 'Lodash', advisoryIds: ['CVE-2019-10744'] }])).toBe('r-ci')
    expect(ciReportFor(group as never, [{ reportId: 'r-ci', packageName: 'lodash', advisoryIds: ['CVE-2000-1'] }])).toBeNull()
  })
})

describe('the Security proof', () => {
  it('is proven only when dependencies and secrets passed for the release commit', () => {
    const proof = computeProof([run({ lane: 'dependencies', tool: 'osv-scanner' }), run({ lane: 'secrets', tool: 'gitleaks' })], { commitSha: SHA.slice(0, 7), at: '2026-11-27T00:00:00Z' }, NOW)
    expect(proof.state).toBe('proven')
    expect(proof.lanes.find((l) => l.lane === 'ai_review')?.state).toBe('off')
    expect(proof.lanes.find((l) => l.lane === 'dast')?.state).toBe('off')
  })

  it('never reads a lane that did not run, or ran for another commit, as green', () => {
    const proof = computeProof([run({ lane: 'dependencies', tool: 'osv-scanner' }), run({ lane: 'secrets', tool: 'gitleaks', commit_sha: '1111111' })], { commitSha: SHA, at: null }, NOW)
    expect(proof.state).toBe('incomplete')
    expect(proof.lanes.find((l) => l.lane === 'secrets')).toMatchObject({ state: 'unknown', tone: 'danger' })
  })

  it('is not_pinned without a commit, and attention with findings', () => {
    expect(computeProof([run({ lane: 'dependencies', tool: 'osv-scanner' })], { commitSha: null, at: null }, NOW).state).toBe('not_pinned')
    const att = computeProof([
      run({ lane: 'dependencies', tool: 'osv-scanner', status: 'findings', counts: { high: 1, total: 1 } }),
      run({ lane: 'secrets', tool: 'gitleaks' }),
    ], { commitSha: SHA, at: null }, NOW)
    expect(att.state).toBe('attention')
    expect(att.lanes[0]).toMatchObject({ state: 'findings', tone: 'danger' })
  })

  it('takes the weekly DAST run when fresh, and calls an old one stale', () => {
    const base = [run({ lane: 'dependencies', tool: 'osv-scanner' }), run({ lane: 'secrets', tool: 'gitleaks' })]
    const fresh = computeProof([...base, run({ lane: 'dast', tool: 'zap-baseline', commit_sha: null, finished_at: '2026-11-24T03:20:00Z' }), run({ lane: 'dast', tool: 'nuclei', commit_sha: null, finished_at: '2026-11-24T03:25:00Z' })], { commitSha: SHA, at: '2026-11-27T00:00:00Z' }, NOW)
    expect(fresh.lanes.find((l) => l.lane === 'dast')).toMatchObject({ state: 'passed' })
    expect(fresh.lanes.find((l) => l.lane === 'dast')?.runs).toHaveLength(2)
    const stale = computeProof([...base, run({ lane: 'dast', tool: 'zap-baseline', commit_sha: null, finished_at: '2026-10-01T03:20:00Z' })], { commitSha: SHA, at: '2026-11-27T00:00:00Z' }, NOW)
    expect(stale.lanes.find((l) => l.lane === 'dast')?.state).toBe('stale')
    expect(stale.state).toBe('attention')
  })

  it('matches short and long SHAs', () => {
    expect(sameCommit('abcdef1', SHA)).toBe(true)
    expect(sameCommit('abcdef', SHA)).toBe(false)
    expect(sameCommit(null, SHA)).toBe(false)
  })
})

describe('ingest', () => {
  const seed = () => makeFakeDb({
    project_settings: [{ project_id: P, security_reports_daily_limit: 5 }],
    dependency_vulns: [{ project_id: P, status: 'open', advisory_id: 'CVE-2019-10744', cve_ids: [], package_name: 'lodash', report_id: 'r-vw' }],
    reports: [],
    security_scan_runs: [],
    security_scan_findings: [],
  }, {
    autoId: true,
    partialUniques: { reports: { keys: ['project_id', 'pattern_key'], where: (r) => r.source === 'security_scan' && r.status === 'classified' } },
  })

  it('links a dependency finding to vuln-watch and files a secret once, then links the next post to it', async () => {
    const db = seed()
    const dep = await ingestSecurityResult(db as never, P, { tool: 'osv-scanner', commitSha: SHA, ref: 'main', event: 'pull_request', prNumber: 7, runUrl: null, targetUrl: null, toolVersion: null, startedAt: null, status: null, skipReason: null, report: osvSarif }, NOW)
    expect(dep).toMatchObject({ status: 'findings', filed: [], linked: [{ reportId: 'r-vw', by: 'vuln_watch' }] })
    const s1 = await ingestSecurityResult(db as never, P, { tool: 'gitleaks', commitSha: SHA, ref: 'main', event: 'pull_request', prNumber: 7, runUrl: null, targetUrl: null, toolVersion: null, startedAt: null, status: null, skipReason: null, report: gitleaksSarif }, NOW)
    expect(s1.filed).toHaveLength(1)
    const s2 = await ingestSecurityResult(db as never, P, { tool: 'gitleaks', commitSha: SHA, ref: 'main', event: 'pull_request', prNumber: 8, runUrl: null, targetUrl: null, toolVersion: null, startedAt: null, status: null, skipReason: null, report: gitleaksSarif }, NOW)
    expect(s2.filed).toHaveLength(0)
    expect(s2.linked[0]).toMatchObject({ reportId: s1.filed[0].reportId, by: 'open_report' })
    const reports = (db as unknown as { tables: Record<string, Array<Record<string, unknown>>> }).tables.reports
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'security_scan', status: 'classified', confidence: 1 })
    expect(JSON.stringify((db as unknown as { tables: Record<string, unknown[]> }).tables.security_scan_findings)).not.toContain(FAKE_KEY)
  })

  it('records a skipped lane without parsing, and the proof reads the stored runs', async () => {
    const db = seed()
    const skipped = await ingestSecurityResult(db as never, P, { tool: 'zap-baseline', commitSha: null, ref: null, event: 'schedule', prNumber: null, runUrl: null, targetUrl: null, toolVersion: null, startedAt: null, status: 'skipped', skipReason: 'MUSHI_STAGING_URL is not set', report: {} }, NOW)
    expect(skipped.status).toBe('skipped')
    await ingestSecurityResult(db as never, P, { tool: 'osv-scanner', commitSha: SHA, ref: 'main', event: 'workflow_dispatch', prNumber: null, runUrl: null, targetUrl: null, toolVersion: null, startedAt: null, status: null, skipReason: null, report: { runs: [{ results: [] }] } }, NOW)
    const proof = await loadSecurityProof(db as never, P, { commitSha: SHA }, NOW)
    expect(proof.lanes.find((l) => l.lane === 'dependencies')?.state).toBe('passed')
    expect(proof.lanes.find((l) => l.lane === 'secrets')?.state).toBe('unknown')
    expect(proof.state).toBe('incomplete')
  })

  it('CI posting results is not an SDK heartbeat', () => {
    const auth = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/auth.ts'), 'utf8')
    expect(auth).toContain("!c.req.path.endsWith('/security/results')")
  })
})
