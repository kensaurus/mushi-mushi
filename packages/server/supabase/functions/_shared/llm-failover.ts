/**
 * FILE: packages/server/supabase/functions/_shared/llm-failover.ts
 * PURPOSE: Quota-aware LLM key failover helper.
 *
 * `withLlmFailover(db, projectId, provider, fn)` iterates the ordered list
 * of active keys, calls `fn(resolvedKey)`, and on quota/auth error:
 *   - 429 → marks key as `quota_exhausted` (1-hour cooldown), advances.
 *   - 401/403 → marks key as `auth_failed`, advances.
 *   - Other errors → re-throws immediately (not key-related).
 *   - No keys remain → throws `LlmFailoverError` with code `ALL_KEYS_EXHAUSTED`.
 *
 * Usage:
 *   const result = await withLlmFailover(db, projectId, 'anthropic', async (key) => {
 *     const anthropic = createAnthropic({ apiKey: key.key })
 *     return generateObject({ model: anthropic('claude-sonnet-4-6'), … })
 *   })
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { resolveLlmKeys, markKeyStatus, type ResolvedKey, type LlmProvider } from './byok.ts'
import { log as rootLog } from './logger.ts'

const log = rootLog.child('llm-failover')

export class LlmFailoverError extends Error {
  code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED'
  provider: LlmProvider
  attempts: number
  lastError: string

  constructor(opts: {
    code: 'ALL_KEYS_EXHAUSTED' | 'NO_KEYS_CONFIGURED'
    provider: LlmProvider
    attempts: number
    lastError: string
  }) {
    super(`LLM failover: ${opts.code} for provider ${opts.provider} after ${opts.attempts} attempt(s). Last error: ${opts.lastError}`)
    this.name = 'LlmFailoverError'
    this.code = opts.code
    this.provider = opts.provider
    this.attempts = opts.attempts
    this.lastError = opts.lastError
  }
}

/** Classify an error thrown from an LLM SDK call into a key-failure category. */
function classifyLlmError(err: unknown): 'quota' | 'auth' | 'other' {
  const msg = String(err)

  // HTTP status codes in the error message (Vercel AI SDK wraps them)
  if (msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('quota')) {
    return 'quota'
  }
  if (msg.includes('401') || msg.includes('403') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid api key')) {
    return 'auth'
  }

  // Check for structured error objects from the AI SDK. Type the access
  // explicitly — `Record<string, unknown>` makes `errObj.response` `unknown`,
  // and reading `.status` off that fails Deno's stricter type check.
  const errObj = err as { status?: number; statusCode?: number; response?: { status?: number } }
  const statusCode = errObj?.status ?? errObj?.statusCode ?? errObj?.response?.status
  if (statusCode === 429) return 'quota'
  if (statusCode === 401 || statusCode === 403) return 'auth'

  return 'other'
}

/**
 * Run `fn` with automatic key-failover. `fn` receives one `ResolvedKey` at a
 * time. On quota/auth failure the key is marked and the next candidate is tried.
 */
export async function withLlmFailover<T>(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
  fn: (key: ResolvedKey) => Promise<T>,
): Promise<T> {
  const candidates = await resolveLlmKeys(db, projectId, provider)

  if (candidates.length === 0) {
    throw new LlmFailoverError({
      code: 'NO_KEYS_CONFIGURED',
      provider,
      attempts: 0,
      lastError: `No ${provider} key configured. Add one in Settings → API Keys.`,
    })
  }

  let lastError = ''
  let attempts = 0

  for (const candidate of candidates) {
    attempts++
    try {
      const result = await fn(candidate)
      return result
    } catch (err) {
      lastError = String(err).slice(0, 500)
      const kind = classifyLlmError(err)

      if (kind === 'quota') {
        log.warn('LLM key quota exhausted; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        })
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'quota_exhausted', lastError)
        }
        continue
      }

      if (kind === 'auth') {
        log.warn('LLM key auth failed; trying next', {
          provider,
          hint: candidate.hint,
          keyId: candidate.keyId,
        })
        if (candidate.keyId) {
          await markKeyStatus(db, candidate.keyId, 'auth_failed', lastError)
        }
        continue
      }

      // Non-key error (schema violation, network timeout, etc.) — re-throw.
      throw err
    }
  }

  throw new LlmFailoverError({
    code: 'ALL_KEYS_EXHAUSTED',
    provider,
    attempts,
    lastError,
  })
}

/**
 * Convenience wrapper that tries Anthropic first, then OpenAI.
 * Returns the result plus which provider was used.
 */
export async function withAnthropicOrOpenAi<T>(
  db: SupabaseClient,
  projectId: string,
  anthropicFn: (key: ResolvedKey) => Promise<T>,
  openAiFn: (key: ResolvedKey) => Promise<T>,
): Promise<{ result: T; usedProvider: 'anthropic' | 'openai' }> {
  // Try Anthropic pool first
  try {
    const result = await withLlmFailover(db, projectId, 'anthropic', anthropicFn)
    return { result, usedProvider: 'anthropic' }
  } catch (err) {
    if (err instanceof LlmFailoverError && (err.code === 'NO_KEYS_CONFIGURED' || err.code === 'ALL_KEYS_EXHAUSTED')) {
      // Fall through to OpenAI
      log.warn('Anthropic exhausted, trying OpenAI', { projectId, reason: err.code })
    } else {
      throw err
    }
  }

  // Try OpenAI pool
  const result = await withLlmFailover(db, projectId, 'openai', openAiFn)
  return { result, usedProvider: 'openai' }
}
