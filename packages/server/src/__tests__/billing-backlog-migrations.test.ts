/**
 * Pins three money-adjacent migrations from the Copilot backlog:
 * - award_tester_points returns the stored balance on an idempotent replay,
 * - the Tremendous worker cron posts through mushi.cron_http_post and stays
 *   inactive until the owner launches payouts,
 * - idx_llm_inv_project_cost carries cost_usd so the billing rollup is
 *   index-only.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (name: string) =>
  readFileSync(resolve(__dirname, '../../supabase/migrations', name), 'utf8')

describe('20261010180900_award_tester_points_idempotent_balance', () => {
  const sql = read('20261010180900_award_tester_points_idempotent_balance.sql')

  it('returns the stored balance when the insert was skipped', () => {
    expect(sql).toMatch(/'balance_after',\s+case when v_ledger_id is null then v_current_balance else v_new_balance end/)
  })

  it('keeps the live signature, definer rights and search_path', () => {
    expect(sql).toMatch(/create or replace function public\.award_tester_points\(\s*p_tester_id uuid,\s*p_delta_points integer,\s*p_reason text,\s*p_submission_id uuid default null::uuid,\s*p_app_id uuid default null::uuid,\s*p_idempotency_key text default null::text\s*\)/)
    expect(sql).toMatch(/security definer\s+set search_path to 'public', 'private'/)
    expect(sql).toMatch(/on conflict \(idempotency_key\) do nothing/)
  })
})

describe('20261010181000_tremendous_worker_cron_repair', () => {
  const sql = read('20261010181000_tremendous_worker_cron_repair.sql')
  const code = sql.replace(/--.*$/gm, '')

  it('posts through the shared cron helper, not an unseeded config key', () => {
    expect(code).toContain("mushi.cron_http_post('tremendous-redemption-worker', '{}'::jsonb)")
    expect(code).not.toContain('edge_function_base_url')
    expect(code).not.toContain('app.service_role_key')
  })

  it('leaves the job inactive: enabling payouts is the owner\'s call', () => {
    expect(code).toMatch(/cron\.alter_job\(jobid, active := false\)\s+from cron\.job\s+where jobname = 'tremendous-redemption-worker'/)
  })
})

describe('20261010181100_llm_inv_project_cost_include', () => {
  const sql = read('20261010181100_llm_inv_project_cost_include.sql')

  it('includes cost_usd in the partial index', () => {
    expect(sql).toMatch(/create index idx_llm_inv_project_cost\s+on public\.llm_invocations \(project_id, created_at desc\)\s+include \(cost_usd\)\s+where cost_usd is not null;/)
  })
})
