/**
 * FILE: packages/server/supabase/functions/_shared/byok.ts
 * PURPOSE: Resolve effective API keys for all BYOK providers
 *          (Bring-Your-Own-Key, V5.3 §2.7+§2.18 + Phase 1 expansion).
 *
 * RESOLUTION ORDER (per provider):
 *   1. byok_keys table (canonical, vault-backed — Phase 1+)
 *   2. project_settings.byok_<provider>_key_ref (legacy columns — back-compat)
 *      - if value starts with `vault://<id>`, dereference via Supabase Vault.
 *      - otherwise treat as raw key (dev only — emit a warning).
 *   3. process.env.<PROVIDER>_API_KEY (host fallback)
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

/** All four provider slugs supported by BYOK. */
export type LlmProvider = 'anthropic' | 'openai' | 'firecrawl' | 'browserbase'

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
  firecrawl: 'FIRECRAWL_API_KEY',
  browserbase: 'BROWSERBASE_API_KEY',
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

export async function resolveLlmKey(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey | null> {
  // Step 1: Check byok_keys table (canonical, vault-backed).
  const { data: keyRow } = await db
    .from('byok_keys')
    .select('vault_secret_id')
    .eq('project_id', projectId)
    .eq('provider_slug', provider)
    .maybeSingle()

  if (keyRow?.vault_secret_id) {
    const ref = `vault://${keyRow.vault_secret_id}`
    const dereffed = await dereferenceKey(db, ref)
    if (dereffed) {
      void recordUsage(db, projectId, provider).catch(() => { /* tolerate */ })
      const baseUrl = provider === 'openai' ? (Deno.env.get('OPENAI_BASE_URL') ?? undefined) : undefined
      return { key: dereffed, source: 'byok', hint: hint(dereffed), baseUrl }
    }
  }

  // Step 2: Fallback to legacy project_settings columns (back-compat).
  const refCol = LEGACY_REF_COL[provider]
  if (refCol) {
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
      log.warn('BYOK legacy ref present but dereference failed; falling back to env', { projectId, provider })
    }
  }

  // Step 3: Platform env-var fallback.
  const env = Deno.env.get(ENV_VAR[provider])
  if (env) {
    // SEC (Wave 5 Gap-D): the platform-default key sees every tenant's data
    // when BYOK is not configured. Log so the operator can surface the
    // "Platform key in use" warning chip in the admin UI (/onboarding, /settings).
    log.warn('BYOK call using platform env key — BYOK not configured for this project', {
      projectId,
      provider,
      hint: hint(env),
    })
    const baseUrl = provider === 'openai' ? (Deno.env.get('OPENAI_BASE_URL') ?? undefined) : undefined
    return { key: env, source: 'env', hint: hint(env), baseUrl }
  }
  return null
}

async function dereferenceKey(db: SupabaseClient, ref: string): Promise<string | null> {
  if (!ref.startsWith('vault://')) {
    const env = Deno.env.get('SUPABASE_ENV') ?? Deno.env.get('NODE_ENV') ?? ''
    const isProd = env === 'production' || env === 'prod'

    // SEC (Wave 5 Gap-E): in production, raw keys in the DB are a security
    // risk (they bypass Vault encryption and any future key-rotation policy).
    // Hard-reject in production so misconfigured tenancies can't silently use
    // unencrypted keys. In dev/staging, emit a warning per process.
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
  const lastUsedCol = LAST_USED_COL[provider]
  if (lastUsedCol) {
    await db.from('project_settings').update({ [lastUsedCol]: new Date().toISOString() }).eq('project_id', projectId)
  }
  await db.from('byok_audit_log').insert({ project_id: projectId, provider, action: 'used' })
}

function hint(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : '****'
}
