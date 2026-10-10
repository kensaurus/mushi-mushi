import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import {
  detectByokKeyInvalid,
  detectIndexHealth,
  detectSpendCapUnset,
  detectWebhookNeverDelivered,
  INDEX_STALE_MS,
  radarRunDue,
  RADAR_RUN_INTERVAL_MS,
  recordRadarRun,
  RadarWriteError,
  WEBHOOK_GRACE_MS,
} from '../_shared/radar.ts'
import { runRadarPass } from './radar-pass.ts'

const NOW = new Date('2026-10-02T12:00:00Z').getTime()
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

// ── Minimal PostgREST stand-in ────────────────────────────────────────────
type Op = { table: string; kind: 'select' | 'insert' | 'update'; filters: Record<string, unknown>; payload?: unknown; head?: boolean }
type Answer = { data?: unknown; error?: { message: string } | null; count?: number }

// deno-lint-ignore no-explicit-any
function fakeDb(answer: (op: Op) => Answer): { db: any; ops: Op[] } {
  const ops: Op[] = []
  const builder = (table: string) => {
    const op: Op = { table, kind: 'select', filters: {} }
    // deno-lint-ignore no-explicit-any
    const b: any = {
      select(_cols?: string, opts?: { head?: boolean }) {
        if (opts?.head) op.head = true
        return b
      },
      insert(payload: unknown) {
        op.kind = 'insert'
        op.payload = payload
        return b
      },
      update(payload: unknown) {
        op.kind = 'update'
        op.payload = payload
        return b
      },
      eq(col: string, v: unknown) {
        op.filters[col] = v
        return b
      },
      gte(col: string, v: unknown) {
        op.filters[`${col}>=`] = v
        return b
      },
      // byok_keys: the project's own keys or its organization's (ADR 0023).
      or(f: string) {
        op.filters.or = f
        return b
      },
      order: () => b,
      limit: () => b,
      range: () => b,
      single: () => b,
      maybeSingle: () => b,
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        ops.push(op)
        try {
          const a = answer(op)
          resolve({ data: a.data ?? null, error: a.error ?? null, count: a.count ?? null })
        } catch (e) {
          reject(e)
        }
      },
    }
    return b
  }
  return { db: { from: builder }, ops }
}

// ── detectors ─────────────────────────────────────────────────────────────

Deno.test('byok_key_invalid: only keys the provider rejected', () => {
  const f = detectByokKeyInvalid([
    { provider_slug: 'openai', label: 'Prod', key_hint: null, status: 'auth_failed', last_error: 'HTTP 401' },
    { provider_slug: 'anthropic', label: null, key_hint: '…z', status: 'active', last_error: null },
  ])
  assertEquals(f.length, 1)
  assertEquals(f[0].rule_id, 'byok_key_invalid')
  assertEquals(f[0].severity, 'error')
})

Deno.test('spend_cap_unset: a missing auto-fix cap or monthly AI budget; silent when everything is capped', () => {
  assertEquals(detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: 20 }), [])
  const [f] = detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: 20 })
  assertEquals(f.rule_id, 'spend_cap_unset')
  assertEquals(f.severity, 'warn')
  assertEquals(f.suggested_fix?.path, '/settings?tab=general#spend-limits')
  assertEquals(f.suggested_fix?.endpoint, '/v1/admin/settings')
  // Only the missing field is suggested, so applying it never overwrites a set cap.
  assertEquals(f.suggested_fix?.values, { autofix_max_spend_usd: 2 })
})

Deno.test('spend_cap_unset: auto-fix off is not skipped; a missing budget is flagged on its own', () => {
  const [off] = detectSpendCapUnset({ autofix_enabled: false, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, monthly_llm_budget_usd: 20 })
  assertEquals(off.severity, 'info')
  assert(off.message.includes('Auto-fix is off'))
  const [budget] = detectSpendCapUnset({ autofix_enabled: false, autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: null, llm_spend_30d_usd: 12.4 })
  assertEquals(budget.severity, 'warn')
  // About twice the last 30 days, rounded up to $5: 12.40 * 2 = 24.80 -> 25.
  assertEquals(budget.suggested_fix?.values, { monthly_llm_budget_usd: 25 })
  assert(budget.message.includes('$12.40'))
})

Deno.test('webhook_never_delivered: configured 7+ days, nothing accepted', () => {
  const old = new Date(NOW - WEBHOOK_GRACE_MS - 1).toISOString()
  const recent = new Date(NOW - WEBHOOK_GRACE_MS + 60_000).toISOString()
  const f = detectWebhookNeverDelivered(
    [
      { source: 'sentry', configuredSince: old, accepted: 0, rejectedSignature: 0 },
      { source: 'slack', configuredSince: old, accepted: 0, rejectedSignature: 4 },
      { source: 'sentry', configuredSince: recent, accepted: 0, rejectedSignature: 0 },
      { source: 'github', configuredSince: old, accepted: 9, rejectedSignature: 1 },
      { source: 'github', configuredSince: null, accepted: 0, rejectedSignature: 0 },
    ],
    NOW,
  )
  assertEquals(f.length, 2)
  assertEquals(f[0].severity, 'warn')
  assert(f[0].message.startsWith('Sentry'))
  assertEquals(f[1].severity, 'error')
  assert(f[1].message.includes('signature'))
})

Deno.test('webhook_never_delivered: Linear/GitHub count only from when deliveries carry a project id', () => {
  const longAgo = '2026-06-01T00:00:00Z'
  const states = [{ source: 'linear' as const, configuredSince: longAgo, accepted: 0, rejectedSignature: 0 }]
  // Two days after stamping starts: still inside the grace period.
  assertEquals(detectWebhookNeverDelivered(states, new Date('2026-10-05T00:00:00Z').getTime()), [])
  // Eight days after: a real finding.
  assertEquals(detectWebhookNeverDelivered(states, new Date('2026-10-11T00:00:00Z').getTime()).length, 1)
  // Sentry has stamped project ids all along: its own history counts.
  assertEquals(
    detectWebhookNeverDelivered([{ source: 'sentry', configuredSince: longAgo, accepted: 0, rejectedSignature: 0 }], new Date('2026-10-05T00:00:00Z').getTime()).length,
    1,
  )
})

Deno.test('index_branch_mismatch and index_stale', () => {
  const repo = { repo_url: 'https://github.com/o/r', configured_branch: 'main', indexed_branch: null, last_indexed_at: daysAgo(20) }
  const f = detectIndexHealth(repo, { default_branch: 'master', pushed_at: daysAgo(1) }, NOW)
  assertEquals(f.map((x) => x.rule_id), ['index_branch_mismatch', 'index_stale'])
  // Indexed recently, or the repo did not move: not stale.
  assertEquals(detectIndexHealth({ ...repo, last_indexed_at: daysAgo(1) }, { default_branch: 'main', pushed_at: daysAgo(2) }, NOW), [])
  const quiet = new Date(NOW - INDEX_STALE_MS - 86_400_000).toISOString()
  assertEquals(detectIndexHealth({ ...repo, last_indexed_at: quiet }, { default_branch: 'main', pushed_at: daysAgo(30) }, NOW), [])
  // GitHub unreadable: no claim either way.
  assertEquals(detectIndexHealth(repo, null, NOW), [])
})

Deno.test('radarRunDue: once per interval', () => {
  assertEquals(radarRunDue(null, NOW), true)
  assertEquals(radarRunDue(new Date(NOW - RADAR_RUN_INTERVAL_MS + 1000).toISOString(), NOW), false)
  assertEquals(radarRunDue(new Date(NOW - RADAR_RUN_INTERVAL_MS).toISOString(), NOW), true)
})

// ── writer ────────────────────────────────────────────────────────────────

Deno.test('recordRadarRun writes a radar gate run plus findings', async () => {
  const { db, ops } = fakeDb((op) => (op.table === 'gate_runs' ? { data: { id: 'run-1' } } : {}))
  const res = await recordRadarRun(
    db,
    'p1',
    detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, monthly_llm_budget_usd: 20 }),
    { triggeredBy: 'test' },
  )
  assertEquals(res, { runId: 'run-1', findings: 1 })
  const run = ops.find((o) => o.table === 'gate_runs')!.payload as Record<string, unknown>
  assertEquals(run.gate, 'radar')
  assertEquals(run.status, 'warn')
  const rows = ops.find((o) => o.table === 'gate_findings')!.payload as Array<Record<string, unknown>>
  assertEquals(rows[0].gate_run_id, 'run-1')
  assertEquals(rows[0].rule_id, 'spend_cap_unset')
})

Deno.test('recordRadarRun throws when the gate CHECK rejects the run (no silent success)', async () => {
  const { db } = fakeDb((op) =>
    op.table === 'gate_runs'
      ? { error: { message: 'new row violates check constraint "gate_runs_gate_check"' } }
      : {},
  )
  await assertRejects(() => recordRadarRun(db, 'p1', [], { triggeredBy: 'test' }), RadarWriteError, 'gate_runs_gate_check')
})

Deno.test('recordRadarRun throws when findings fail to insert', async () => {
  const { db } = fakeDb((op) =>
    op.table === 'gate_runs' ? { data: { id: 'run-1' } } : op.table === 'gate_findings' ? { error: { message: 'boom' } } : {},
  )
  const findings = detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, monthly_llm_budget_usd: 20 })
  await assertRejects(() => recordRadarRun(db, 'p1', findings, { triggeredBy: 'test' }), RadarWriteError, 'gate_findings')
})

// ── pass ──────────────────────────────────────────────────────────────────

Deno.test('runRadarPass: a failed read is reported per project, never as "no findings"', async () => {
  const { db, ops } = fakeDb((op) => {
    if (op.table === 'project_settings') {
      return {
        data: [
          { project_id: 'ok', autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, sentry_webhook_secret: 'x', linear_webhook_secret_ref: null, slack_team_id: null },
          { project_id: 'broken', autofix_enabled: false, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, sentry_webhook_secret: null, linear_webhook_secret_ref: null, slack_team_id: null },
          { project_id: 'recent', autofix_enabled: false, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null, sentry_webhook_secret: null, linear_webhook_secret_ref: null, slack_team_id: null },
        ],
      }
    }
    if (op.table === 'gate_runs' && op.kind === 'select') return { data: [{ project_id: 'recent', started_at: daysAgo(0.1) }] }
    if (op.table === 'gate_runs' && op.kind === 'insert') return { data: { id: `run-${String(op.filters.project_id ?? '')}` } }
    if (op.table === 'byok_keys') return { data: [] }
    if (op.table === 'project_repos') {
      return op.filters.project_id === 'broken'
        ? { error: { message: 'column project_repos.indexed_branch does not exist' } }
        : { data: [{ repo_url: 'https://github.com/o/r', default_branch: 'main', indexed_branch: 'main', last_indexed_at: daysAgo(1), github_app_installation_id: null, indexing_enabled: true, is_primary: true }] }
    }
    if (op.table === 'integration_health_history') return { data: { checked_at: daysAgo(30) } }
    if (op.table === 'webhook_audit_log') return { count: 0 }
    if (op.table === 'llm_invocations') {
      return op.filters.project_id === 'ok'
        ? { data: [{ used_model: null, input_tokens: 0, output_tokens: 0, cost_usd: 3 }], count: 1 }
        : { data: [], count: 0 }
    }
    return {}
  })
  const res = await runRadarPass(db, {
    nowMs: NOW,
    githubFacts: () => Promise.resolve({ default_branch: 'main', pushed_at: daysAgo(2) }),
  })
  assertEquals(res.ran, 1)
  assertEquals(res.skipped, 1)
  assertEquals(res.failed.length, 1)
  assertEquals(res.failed[0].projectId, 'broken')
  assert(res.failed[0].error.includes('indexed_branch'))
  // The failure is written as an `error` run, so the next tick skips it.
  const errorRun = ops.find((o) => o.table === 'gate_runs' && o.kind === 'insert' && (o.payload as { status?: string }).status === 'error')
  assert(errorRun, 'an error run is recorded for the failed project')
  assertEquals((errorRun!.payload as { project_id: string }).project_id, 'broken')
  assert(String((errorRun!.payload as { summary: { error: string } }).summary.error).includes('indexed_branch'))
  // spend_cap_unset + webhook_never_delivered (sentry configured 30 days, 0 accepted)
  assertEquals(res.findings, 2)
  const written = ops.filter((o) => o.table === 'gate_findings').flatMap((o) => o.payload as Array<{ rule_id: string }>)
  assertEquals(written.map((r) => r.rule_id).sort(), ['spend_cap_unset', 'webhook_never_delivered'])
  // No budget on 'ok': the suggestion is read from its last 30 days ($3 -> floor $10).
  const spendRow = ops.filter((o) => o.table === 'gate_findings').flatMap((o) => o.payload as Array<{ rule_id: string; suggested_fix: { values: Record<string, number> } }>).find((r) => r.rule_id === 'spend_cap_unset')!
  assertEquals(spendRow.suggested_fix.values.monthly_llm_budget_usd, 10)
})
