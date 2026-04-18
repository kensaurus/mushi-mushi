/**
 * FILE: packages/server/supabase/functions/_shared/byok.ts
 * PURPOSE: Resolve effective LLM API keys (Bring-Your-Own-Key, V5.3 §2.7+§2.18).
 *
 * RESOLUTION ORDER (per provider):
 *   1. project_settings.byok_<provider>_key_ref (BYOK)
 *      - if value starts with `vault://<id>`, dereference via Supabase Vault.
 *      - otherwise treat as raw key (dev only — emit a warning).
 *   2. process.env.<PROVIDER>_API_KEY (host fallback)
 *
 * The function returns null when neither is available so callers can fail with
 * a structured error instead of accidentally calling the API with `undefined`.
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

export type LlmProvider = 'anthropic' | 'openai'

export interface ResolvedKey {
  key: string
  source: 'byok' | 'env'
  /** Last 4 chars of the key — safe to log. */
  hint: string
  /**
   * Optional base URL for OpenAI-compatible providers (OpenRouter, Together,
   * Fireworks). Only set for `openai` when `byok_openai_base_url` is configured.
   * The Vercel AI SDK's `createOpenAI` accepts this as `baseURL`.
   */
  baseUrl?: string
}

const ENV_VAR: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
}

const REF_COL: Record<LlmProvider, string> = {
  anthropic: 'byok_anthropic_key_ref',
  openai: 'byok_openai_key_ref',
}

const LAST_USED_COL: Record<LlmProvider, string> = {
  anthropic: 'byok_anthropic_key_last_used_at',
  openai: 'byok_openai_key_last_used_at',
}

export async function resolveLlmKey(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey | null> {
  const refCol = REF_COL[provider]
  // Pull base URL alongside the ref so the OpenRouter / OpenAI-compatible
  // gateway path is a single round-trip. The column doesn't exist on the
  // anthropic side; the select tolerates missing columns by selecting only
  // what each provider needs.
  const selectCols = provider === 'openai'
    ? `${refCol}, byok_openai_base_url`
    : refCol
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
      return { key: dereffed, source: 'byok', hint: hint(dereffed), baseUrl }
    }
    log.warn('BYOK ref present but dereference failed; falling back to env', { projectId, provider })
  }

  const env = Deno.env.get(ENV_VAR[provider])
  if (env) return { key: env, source: 'env', hint: hint(env), baseUrl }
  return null
}

async function dereferenceKey(db: SupabaseClient, ref: string): Promise<string | null> {
  if (!ref.startsWith('vault://')) {
    // Raw key in DB — flag once per process so we don't spam logs.
    if (!warnedRaw) {
      warnedRaw = true
      log.warn('BYOK is using raw key in DB; switch to vault://<id> for production', {})
    }
    return ref
  }
  const id = ref.slice('vault://'.length)
  // Supabase Vault: vault.decrypted_secrets is exposed via SECURITY DEFINER fn.
  // We use rpc to call a pre-existing helper named `vault_get_secret`.
  // If the rpc is missing, the deref returns null and the env fallback applies.
  const { data, error } = await db.rpc('vault_get_secret', { secret_id: id })
  if (error) {
    log.warn('vault_get_secret rpc failed', { error: error.message })
    return null
  }
  return typeof data === 'string' ? data : null
}

let warnedRaw = false

async function recordUsage(db: SupabaseClient, projectId: string, provider: LlmProvider): Promise<void> {
  await db.from('project_settings').update({ [LAST_USED_COL[provider]]: new Date().toISOString() }).eq('project_id', projectId)
  await db.from('byok_audit_log').insert({ project_id: projectId, provider, action: 'used' })
}

function hint(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '****'
}
