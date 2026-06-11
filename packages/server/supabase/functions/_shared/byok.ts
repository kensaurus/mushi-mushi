/**
 * FILE: packages/server/supabase/functions/_shared/byok.ts
 * PURPOSE: Resolve effective API keys for all BYOK providers
 *          (Bring-Your-Own-Key, Phase 0 multi-key pool).
 *
 * RESOLUTION ORDER (per provider):
 *   1. byok_keys table — ordered by priority ASC, skips cooldown/disabled/auth_failed
 *      Returns all active candidates for withLlmFailover() to iterate.
 *   2. project_settings.byok_<provider>_key_ref (legacy columns — back-compat)
 *   3. process.env.<PROVIDER>_API_KEY (host fallback)
 *
 * SECURITY:
 *   - Logs the source ('byok' | 'env') and last-used timestamp; NEVER logs the
 *     key itself or any prefix beyond `sk-…<last 4>`.
 *   - The audit log row in `byok_audit_log` is written best-effort; it MUST
 *     NOT block the LLM call.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('byok')

/** All provider slugs supported by BYOK (Phase 0 adds 'cursor'). */
export type LlmProvider = 'anthropic' | 'openai' | 'firecrawl' | 'browserbase' | 'cursor'

export type KeyStatus = 'active' | 'disabled' | 'quota_exhausted' | 'auth_failed'

export interface ResolvedKey {
  /** byok_keys row id (null for legacy/env) */
  keyId?: string
  key: string
  source: 'byok' | 'env'
  /** Last 4 chars of the key — safe to log. */
  hint: string
  /**
   * Optional base URL for OpenAI-compatible providers (OpenRouter, Together,
   * Fireworks). Only set for `openai` when `byok_openai_base_url` is configured.
   */
  baseUrl?: string
  /** Human label if set on the key row */
  label?: string
}

const ENV_VAR: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  browserbase: 'BROWSERBASE_API_KEY',
  cursor: 'CURSOR_API_KEY',
}

/** Legacy project_settings column names (backward-compat fallback). */
const LEGACY_REF_COL: Partial<Record<LlmProvider, string>> = {
  anthropic: 'byok_anthropic_key_ref',
  openai: 'byok_openai_key_ref',
  firecrawl: 'byok_firecrawl_key_ref',
  browserbase: 'byok_browserbase_key_ref',
}

const LAST_USED_COL: Partial<Record<LlmProvider, string>> = {
  anthropic: 'byok_anthropic_key_last_used_at',
  openai: 'byok_openai_key_last_used_at',
  firecrawl: 'byok_firecrawl_key_last_used_at',
}

/**
 * Resolve a single key (best-available). Maintains full back-compat with
 * single-key callers. Returns the highest-priority active key.
 */
export async function resolveLlmKey(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey | null> {
  const candidates = await resolveLlmKeys(db, projectId, provider)
  return candidates[0] ?? null
}

/**
 * Resolve ALL active candidate keys for a provider, ordered by priority ASC.
 * Used by withLlmFailover() to iterate through keys on quota/auth failure.
 * Skips keys that are cooled down or in non-active states.
 */
export async function resolveLlmKeys(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey[]> {
  const nowMs = Date.now()

  // Step 1: byok_keys table — ordered candidates, skip cooled-down entries.
  // Include 'quota_exhausted' so a key that hit a 429 can re-enter the pool
  // once its `cooldown_until` window elapses (the per-row guard below skips
  // keys that are still cooling). Without this, a single 429 would drop the
  // key permanently until a human re-enabled it. 'auth_failed' and 'disabled'
  // stay excluded — those require explicit operator action to recover.
  const { data: keyRows } = await db
    .from('byok_keys')
    .select('id, vault_secret_id, label, priority, status, cooldown_until')
    .eq('project_id', projectId)
    .eq('provider_slug', provider)
    .in('status', ['active', 'quota_exhausted'])
    .order('priority', { ascending: true })

  const candidates: ResolvedKey[] = []

  if (keyRows && keyRows.length > 0) {
    for (const row of keyRows) {
      // Skip keys still inside their cooldown window. Compare as epoch
      // milliseconds — Supabase can return timestamps with varying offset /
      // millisecond precision, so lexical string comparison is unreliable.
      // An unparseable timestamp yields NaN (never > nowMs) → key stays usable.
      if (row.cooldown_until && new Date(row.cooldown_until).getTime() > nowMs) continue
      if (!row.vault_secret_id) continue

      const ref = `vault://${row.vault_secret_id}`
      const dereffed = await dereferenceKey(db, ref)
      if (dereffed) {
        // A previously quota_exhausted key whose cooldown has elapsed is
        // viable again — flip it back to 'active' so the health view and
        // future queries reflect reality. Best-effort; never blocks the call.
        if (row.status === 'quota_exhausted') {
          void reactivateKey(db, row.id)
        }
        void recordUsage(db, projectId, provider).catch(() => { /* tolerate */ })
        const baseUrl = provider === 'openai' ? (Deno.env.get('OPENAI_BASE_URL') ?? undefined) : undefined
        candidates.push({
          keyId: row.id,
          key: dereffed,
          source: 'byok',
          hint: hint(dereffed),
          baseUrl,
          label: row.label ?? undefined,
        })
      }
    }
  }

  if (candidates.length > 0) return candidates

  // Step 2: Legacy project_settings columns (back-compat).
  const refCol = LEGACY_REF_COL[provider]
  if (refCol) {
    const selectCols = provider === 'openai' ? `${refCol}, byok_openai_base_url` : refCol
    const { data: settings, error } = await db
      .from('project_settings')
      .select(selectCols)
      .eq('project_id', projectId)
      .single()

    if (error) log.warn('Failed to read project_settings for BYOK', { projectId, provider, error: error.message })

    const row = settings as Record<string, string | null> | null
    const ref = row?.[refCol]
    const baseUrl = provider === 'openai'
      ? (row?.byok_openai_base_url ?? Deno.env.get('OPENAI_BASE_URL') ?? undefined)
      : undefined

    if (ref) {
      const dereffed = await dereferenceKey(db, ref)
      if (dereffed) {
        void recordUsage(db, projectId, provider).catch(() => { /* tolerate */ })
        return [{ key: dereffed, source: 'byok', hint: hint(dereffed), baseUrl }]
      }
      log.warn('BYOK legacy ref present but dereference failed; falling back to env', { projectId, provider })
    }
  }

  // Step 3: Platform env-var fallback.
  const env = Deno.env.get(ENV_VAR[provider])
  if (env) {
    log.warn('BYOK call using platform env key — BYOK not configured for this project', { projectId, provider, hint: hint(env) })
    const baseUrl = provider === 'openai' ? (Deno.env.get('OPENAI_BASE_URL') ?? undefined) : undefined
    return [{ key: env, source: 'env', hint: hint(env), baseUrl }]
  }

  return []
}

/**
 * Mark a byok_keys row with a new status (called by withLlmFailover on error).
 * Quota exhaustion sets a 1-hour cooldown so the key is tried again later.
 */
export async function markKeyStatus(
  db: SupabaseClient,
  keyId: string,
  status: Exclude<KeyStatus, 'active'>,
  reason: string,
): Promise<void> {
  const cooldownUntil = status === 'quota_exhausted'
    ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
    : null

  // PostgREST query builders are thenables (`then` only) — they have no
  // `.catch`, and they resolve with `{ error }` rather than rejecting. Await
  // and inspect `error` instead of chaining `.catch`, which would throw a
  // TypeError and (because this runs inside withLlmFailover's catch block)
  // abort the whole failover loop on the first 429/401.
  const { error } = await db
    .from('byok_keys')
    .update({
      status,
      last_error: reason.slice(0, 500),
      cooldown_until: cooldownUntil,
    })
    .eq('id', keyId)
  if (error) {
    log.warn('markKeyStatus failed (non-fatal)', { keyId, status, error: error.message })
  }
}

/**
 * Best-effort: clear quota_exhausted state on a key whose cooldown elapsed.
 * Never throws — a failed reset just leaves the (now-usable) key flagged.
 */
async function reactivateKey(db: SupabaseClient, keyId: string): Promise<void> {
  const { error } = await db
    .from('byok_keys')
    .update({ status: 'active', cooldown_until: null })
    .eq('id', keyId)
  if (error) log.warn('reactivateKey failed (non-fatal)', { keyId, error: error.message })
}

async function dereferenceKey(db: SupabaseClient, ref: string): Promise<string | null> {
  if (!ref.startsWith('vault://')) {
    const env = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('NODE_ENV') ?? ''
    const isProd = env === 'production' || env === 'prod'

    if (isProd) {
      log.error('BYOK raw key rejected in production environment — use vault://<id>', {})
      return null
    }

    if (!warnedRaw) {
      warnedRaw = true
      log.warn('BYOK is using raw key in DB; this is only allowed in dev/staging. Switch to vault://<id> for production.', {})
    }
    return ref
  }
  const id = ref.slice('vault://'.length)
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) {
    log.warn('vault_get_secret rpc failed', { error: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

let warnedRaw = false

async function recordUsage(db: SupabaseClient, projectId: string, provider: LlmProvider): Promise<void> {
  const lastUsedCol = LAST_USED_COL[provider]
  if (lastUsedCol) {
    await db.from('project_settings').update({ [lastUsedCol]: new Date().toISOString() }).eq('project_id', projectId)
  }
  await db.from('byok_audit_log').insert({ project_id: projectId, provider, action: 'used' })
}

function hint(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '****'
}
