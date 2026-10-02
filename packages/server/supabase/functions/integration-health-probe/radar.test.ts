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
      order: () => b,
      limit: () => b,
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

Deno.test('spend_cap_unset: auto-fix on with a missing cap; silent when off or capped', () => {
  assertEquals(detectSpendCapUnset({ autofix_enabled: false, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null }), [])
  assertEquals(detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3 }), [])
  const [f] = detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: 3 })
  assertEquals(f.rule_id, 'spend_cap_unset')
  assertEquals((f.suggested_fix?.body as Record<string, unknown>).maxSpendUsd, 2)
})

Deno.test('webhook_never_delivered: configured 7+ days, nothing accepted', () => {
  const old = new Date(NOW - WEBHOOK_GRACE_MS - 1).toISOString()
  const recent = new Date(NOW - WEBHOOK_GRACE_MS + 60_000).toISOString()
  const f = detectWebhookNeverDelivered(
    [
      { source: 'sentry', configuredSince: old, accepted: 0, rejectedSignature: 0 },
      { source: 'linear', configuredSince: old, accepted: 0, rejectedSignature: 4 },
      { source: 'slack', configuredSince: recent, accepted: 0, rejectedSignature: 0 },
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
    detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null }),
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
  const findings = detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null })
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
  // spend_cap_unset + webhook_never_delivered (sentry configured 30 days, 0 accepted)
  assertEquals(res.findings, 2)
  const written = ops.filter((o) => o.table === 'gate_findings').flatMap((o) => o.payload as Array<{ rule_id: string }>)
  assertEquals(written.map((r) => r.rule_id).sort(), ['spend_cap_unset', 'webhook_never_delivered'])
})
