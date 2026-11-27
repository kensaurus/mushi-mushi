/**
 * FILE: packages/server/supabase/functions/_shared/test-account-hook-io.ts
 * PURPOSE: The reads and writes around a project's test-account hook and the
 *          end of a fresh-eyes run (ADR 0073):
 *            - the hook's address and signing secret (project_settings + Vault);
 *            - one account from the hook for a claimed run;
 *            - when a run ends (the CLI synced it done or failed, it was
 *              cancelled, it waited a day, or its worker lost the lease): its
 *              LLM reservation is released and the hook is asked to delete
 *              the accounts it made for it.
 *          The pure rules are in test-account-hook.ts and llm-reservations.ts.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log } from './logger.ts'
import { releaseRunBudget } from './llm-reservations.ts'
import { runtimeResolver } from './public-url-guard.ts'
import { expireHookAccounts, requestHookAccount, type HookAccount } from './test-account-hook.ts'

const hlog = log.child('test-account-hook')

/** Vault name of a project's hook secret (vault_store_secret checks the prefix). */
export function hookSecretName(projectId: string): string {
  return `mushi_${projectId}_fresh_eyes_hook`
}

/** The hook's address and secret, or null when the project has none set (or the secret cannot be read). */
export async function loadHookConfig(db: SupabaseClient, projectId: string): Promise<{ url: string; secret: string } | null> {
  const { data, error } = await db.from('project_settings').select('fresh_eyes_account_hook_url, fresh_eyes_account_hook_secret_id').eq('project_id', projectId).maybeSingle()
  if (error || !data) return null
  const row = data as { fresh_eyes_account_hook_url: string | null; fresh_eyes_account_hook_secret_id: string | null }
  if (!row.fresh_eyes_account_hook_url || !row.fresh_eyes_account_hook_secret_id) return null
  const { data: secret, error: vaultErr } = await db.rpc('vault_get_secret', { secret_id: row.fresh_eyes_account_hook_secret_id })
  if (vaultErr || typeof secret !== 'string' || !secret) {
    hlog.warn('hook secret unreadable', { projectId, err: vaultErr?.message })
    return null
  }
  return { url: row.fresh_eyes_account_hook_url, secret }
}

export interface HookAccountInput {
  projectId: string
  runId: string
  visitor: number
  expiresAt: string
  persona: { name: string; locale: string } | null
}

/** One account from the project's hook, for one visitor of a claimed run. */
export async function hookAccountFor(db: SupabaseClient, input: HookAccountInput): Promise<{ ok: true; account: HookAccount } | { ok: false; message: string }> {
  const cfg = await loadHookConfig(db, input.projectId)
  if (!cfg) return { ok: false, message: 'The app has no test-account hook set (or its secret could not be read).' }
  return requestHookAccount(cfg.url, cfg.secret, input, { resolver: runtimeResolver() })
}

/**
 * Everything a run's end owes: the reservation back, and the hook asked to
 * delete the run's accounts (once: the refs are cleared first). Never throws.
 */
export async function settleFreshEyesRun(db: SupabaseClient, run: { id: string; project_id: string; local_run_id: string }): Promise<void> {
  const freed = await releaseRunBudget(db, run.id)
  if (freed === null) hlog.warn('reservation not released', { runId: run.local_run_id })
  try {
    const { data, error } = await db.from('ux_runs').select('account_refs').eq('id', run.id).maybeSingle()
    const refs = ((data as { account_refs?: unknown } | null)?.account_refs ?? null) as unknown
    if (error || !Array.isArray(refs) || refs.length === 0) return
    await db.from('ux_runs').update({ account_refs: null }).eq('id', run.id)
    const cfg = await loadHookConfig(db, run.project_id)
    if (!cfg) return
    const r = await expireHookAccounts(cfg.url, cfg.secret, { projectId: run.project_id, runId: run.local_run_id, accounts: refs.filter((x): x is string => typeof x === 'string') }, { resolver: runtimeResolver() })
    if (!r.ok) hlog.warn('hook accounts not expired', { runId: run.local_run_id, why: r.message })
  } catch (err) {
    hlog.warn('run end not settled', { runId: run.local_run_id, err: String(err).slice(0, 200) })
  }
}
