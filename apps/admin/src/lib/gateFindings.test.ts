import { describe, expect, it } from 'vitest'
import { describeSpendCaps, findingsReadTruncated, groupFindingsByCheck, latestOpenFindings, planSpendCaps, spendCapSuggestion } from './gateFindings'
import { gateInfo, gateLabel } from './gateLabels'

describe('latestOpenFindings', () => {
  it('keeps the newest finished run per gate, drops allowlisted, most severe first', () => {
    const out = latestOpenFindings({
      runs: [
        { id: 'r-running', gate: 'radar', status: 'running' },
        { id: 'r-new', gate: 'radar', status: 'warn' },
        { id: 'r-old', gate: 'radar', status: 'warn' },
        { id: 'c-1', gate: 'code_health', status: 'fail' },
      ],
      findings: [
        { id: 'a', gate_run_id: 'r-new', severity: 'info', message: 'a' },
        { id: 'b', gate_run_id: 'r-old', severity: 'error', message: 'b' },
        { id: 'c', gate_run_id: 'c-1', severity: 'error', message: 'c' },
        { id: 'd', gate_run_id: 'c-1', severity: 'warn', message: 'd', allowlisted: true },
      ],
    })
    expect(out.map((f) => [f.id, f.gate])).toEqual([['c', 'code_health'], ['a', 'radar']])
  })
})

describe('design refresh runs and the route caps', () => {
  it('a design refresh or a CI push that is not a scan never hides the latest design scan', () => {
    const out = latestOpenFindings({
      runs: [
        { id: 'refresh', gate: 'design_drift', status: 'pass', summary: { phase: 'refresh' } },
        { id: 'pr-push', gate: 'design_drift', status: 'pass', summary: { phase: 'ci_branch_scan' } },
        { id: 'public-key-push', gate: 'design_drift', status: 'pass', summary: { phase: 'ci_untrusted_scan' } },
        { id: 'scan', gate: 'design_drift', status: 'fail', summary: { phase: 'scan' } },
      ],
      findings: [{ id: 'f', gate_run_id: 'scan', severity: 'warn', message: 'off-token colour' }],
    })
    expect(out.map((f) => f.id)).toEqual(['f'])
  })

  it('reports a read that hit the 50-run or 500-finding cap', () => {
    const runs = Array.from({ length: 50 }, (_, i) => ({ id: `r${i}`, gate: 'code_health', status: 'pass' }))
    expect(findingsReadTruncated({ runs, findings: [] })).toBe(true)
    expect(findingsReadTruncated({ runs: runs.slice(0, 3), findings: [] })).toBe(false)
    const findings = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, gate_run_id: 'r0', message: 'm' }))
    expect(findingsReadTruncated({ runs: runs.slice(0, 1), findings })).toBe(true)
  })
})

describe('spendCapSuggestion', () => {
  it('reads only valid caps from a spend_cap_unset finding', () => {
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: { values: { monthly_llm_budget_usd: 10, autofix_max_spend_usd: -1, other: 4 } } }))
      .toEqual({ monthly_llm_budget_usd: 10 })
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: { values: { autofix_max_spend_usd: 0 } } })).toBeNull()
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: null })).toBeNull()
    expect(spendCapSuggestion({ rule_id: 'byok_key_invalid', suggested_fix: { values: { monthly_llm_budget_usd: 10 } } })).toBeNull()
  })

  it('describes each cap in plain English, saying what the budget stops', () => {
    const lines = describeSpendCaps({ monthly_llm_budget_usd: 25, autofix_max_dispatches_per_day: 3 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/\$25.*stops/)
    expect(lines[1]).toBe('Automatic fixes per day: 3.')
  })
})

describe('planSpendCaps', () => {
  const suggested = { monthly_llm_budget_usd: 25, autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3 }

  it('keeps only the caps that are still unset now', () => {
    expect(planSpendCaps(suggested, { monthly_llm_budget_usd: 0, autofix_max_spend_usd: null })).toEqual({
      toSet: { autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3 },
      alreadySet: ['Monthly AI budget'],
    })
  })

  it('sets nothing when every suggested cap exists', () => {
    expect(planSpendCaps({ autofix_max_spend_usd: 2 }, { autofix_max_spend_usd: '7.50' })).toEqual({ toSet: {}, alreadySet: ['Auto-fix spend limit'] })
  })

  it('treats a project with no settings row as nothing set', () => {
    expect(planSpendCaps(suggested, {})).toEqual({ toSet: suggested, alreadySet: [] })
  })
})

describe('gate labels', () => {
  it('labels every gate, including the setup and hole checks', () => {
    // Every gate is pinned by packages/server/src/__tests__/gate-ids-parity.test.ts.
    for (const gate of ['ci_drift', 'deploy_drift', 'env_drift', 'design_drift', 'code_health', 'portfolio_radar', 'portfolio_radar_ci']) {
      expect(gateLabel(gate), gate).not.toBe(gate)
    }
    expect(gateLabel('radar')).toBe('Mushi setup checks')
    expect(gateLabel('store_review')).toBe('Store review checklist')
    expect(gateLabel('not_a_gate')).toBe('not_a_gate')
  })
})

describe('groupFindingsByCheck', () => {
  const NOW = Date.parse('2026-10-07T12:00:00Z')
  const payload = {
    runs: [
      { id: 's1', gate: 'schema_drift', status: 'warn', started_at: '2026-10-07T03:05:00Z', completed_at: '2026-10-07T03:06:00Z', commit_sha: null },
      { id: 'd1', gate: 'design_drift', status: 'warn', summary: { phase: 'scan' }, started_at: '2026-10-05T03:35:00Z', completed_at: '2026-10-05T03:36:00Z', commit_sha: '3ea709ba6' },
      { id: 'c1', gate: 'crawl', status: 'fail', started_at: '2026-05-04T00:00:00Z', completed_at: '2026-05-04T00:10:00Z' },
      { id: 'e1', gate: 'env_drift', status: 'pass', started_at: '2026-10-05T00:00:00Z', completed_at: '2026-10-05T00:00:00Z' },
    ],
    findings: [
      { id: 'a', gate_run_id: 's1', severity: 'warn', rule_id: 'schema-drift-table-modified', message: 't1' },
      { id: 'b', gate_run_id: 's1', severity: 'warn', rule_id: 'schema-drift-table-modified', message: 't2' },
      { id: 'c', gate_run_id: 'd1', severity: 'warn', rule_id: 'off_token_color', message: 'white off the palette' },
      { id: 'd', gate_run_id: 'c1', severity: 'error', rule_id: 'crawl-fetch-failed', message: '/x' },
    ],
  }

  it('gives each check its run time, commit, rule counts and an old-result flag', () => {
    const groups = groupFindingsByCheck(payload, NOW)
    expect(groups.map((g) => g.gate)).toEqual(['schema_drift', 'design_drift', 'crawl', 'env_drift'])
    const schema = groups.find((g) => g.gate === 'schema_drift')!
    expect(schema).toMatchObject({ open: 2, stale: false, rules: [{ rule: 'schema-drift-table-modified', count: 2 }] })
    expect(groups.find((g) => g.gate === 'design_drift')).toMatchObject({ commitSha: '3ea709ba6', open: 1 })
    // A May result is still listed, after current problems, and flagged as old.
    expect(groups.find((g) => g.gate === 'crawl')).toMatchObject({ stale: true, open: 1 })
    expect(groups.find((g) => g.gate === 'env_drift')).toMatchObject({ open: 0 })
  })

  it('names what every check looks at and where to work on it', () => {
    expect(gateInfo('design_drift')?.page?.to).toBe('/design')
    expect(gateInfo('schema_drift')?.checks).toMatch(/Supabase schema/)
    expect(gateInfo('not_a_gate')).toBeNull()
  })
})
