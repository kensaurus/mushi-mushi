/**
 * FILE: packages/server/supabase/functions/_shared/synthetic-accounts.ts
 * PURPOSE: Make one synthetic test account for a fresh-eyes run (ADR 0053):
 *          a confirmed Supabase user flagged `app_metadata.synthetic`, listed
 *          in `synthetic_accounts` and `operator_users` (so no company count,
 *          lifecycle email or product event sees it), deleted by the daily
 *          retention sweep after 24 h.
 *
 *          Two callers, both on an operator's authority only:
 *            - POST /v1/admin/fresh-eyes/test-account (the operator's own CLI);
 *            - POST /v1/worker/claim for a run the operator queued from the
 *              console with a test account, claimed by that operator's own
 *              worker (ADR 0053 amendment 2026-10-28). The worker key itself
 *              never gains the right to mint.
 *
 *          The password is returned once to the caller and never stored,
 *          logged or synced.
 */

import type { getServiceClient } from './db.ts'
import { log } from './logger.ts'
import { SYNTHETIC_MINT_RATE_SCOPE, SYNTHETIC_MINTS_PER_HOUR, syntheticEmailDomain, syntheticIdentity } from './fresh-eyes.ts'

type Db = ReturnType<typeof getServiceClient>

const slog = log.child('synthetic-accounts')

export interface SyntheticAccount {
  userId: string
  email: string
  password: string
  name: string
  expiresAt: string
}

export type MintResult = { ok: true; account: SyntheticAccount } | { ok: false; code: string; message: string; status: 403 | 429 | 500 | 502 | 503 }

/**
 * One account, made by `createdBy` (an operator; the caller checked). Counts
 * against that operator's hourly limit. Never leaves an unflagged account:
 * when flagging fails the user is deleted again.
 */
export async function mintSyntheticAccount(db: Db, createdBy: string, now: Date, emailDomain: string | null | undefined): Promise<MintResult> {
  // A synthetic account can never mint another one.
  const { data: selfSynthetic, error: synErr } = await db.from('synthetic_accounts').select('user_id').eq('user_id', createdBy).maybeSingle()
  if (synErr) return { ok: false, code: 'DB_ERROR', message: 'Could not check the caller.', status: 500 }
  if (selfSynthetic) return { ok: false, code: 'FORBIDDEN', message: 'A test account cannot mint test accounts.', status: 403 }

  const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
    p_user_id: createdBy,
    p_scope: SYNTHETIC_MINT_RATE_SCOPE,
    p_max_per_window: SYNTHETIC_MINTS_PER_HOUR,
    p_window: '1 hour',
  })
  if (rateErr) {
    const limited = (rateErr.message ?? '').includes('rate_limit_exceeded')
    return limited
      ? { ok: false, code: 'RATE_LIMITED', message: `At most ${SYNTHETIC_MINTS_PER_HOUR} test accounts an hour.`, status: 429 }
      : { ok: false, code: 'RATE_LIMIT_UNAVAILABLE', message: 'No account was made. Retry in a moment.', status: 503 }
  }

  const id = syntheticIdentity(crypto.getRandomValues(new Uint8Array(34)), syntheticEmailDomain(emailDomain), now)
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email: id.email,
    password: id.password,
    email_confirm: true,
    // app_metadata is set at insert, so triggers that run on the new user already see the flag.
    app_metadata: { synthetic: true, synthetic_purpose: 'fresh_eyes' },
    user_metadata: { full_name: id.name, signup_source: 'fresh_eyes' },
  })
  const newId = created?.user?.id
  if (createErr || !newId) {
    slog.error('synthetic account not created', { err: createErr?.message })
    return { ok: false, code: 'UPSTREAM_ERROR', message: 'The test account could not be created.', status: 502 }
  }
  const rows = await Promise.all([
    db.from('synthetic_accounts').insert({ user_id: newId, email: id.email, purpose: 'fresh_eyes', created_by: createdBy, expires_at: id.expiresAt }),
    db.from('operator_users').upsert({ user_id: newId, note: `synthetic fresh-eyes account, expires ${id.expiresAt}` }, { onConflict: 'user_id' }),
  ])
  const failed = rows.find((r) => r.error)
  if (failed?.error) {
    // Never leave an unflagged account behind.
    await db.auth.admin.deleteUser(newId).catch(() => undefined)
    slog.error('synthetic account not flagged, deleted', { err: failed.error.message })
    return { ok: false, code: 'DB_ERROR', message: 'The test account could not be flagged, so it was deleted again.', status: 500 }
  }
  return { ok: true, account: { userId: newId, email: id.email, password: id.password, name: id.name, expiresAt: id.expiresAt } }
}
