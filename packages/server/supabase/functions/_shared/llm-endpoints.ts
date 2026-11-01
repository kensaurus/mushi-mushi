/**
 * FILE: packages/server/supabase/functions/_shared/llm-endpoints.ts
 * PURPOSE: Where Anthropic calls go (Plan 023 Phase 1, ADR 0034).
 *
 * Order: the key's own `byok_keys.base_url` (an `anthropic` row may carry
 * one now), else the platform `ANTHROPIC_BASE_URL`, else api.anthropic.com.
 * Both are validated by `validateAnthropicBaseUrl`: https on 443 to
 * api.anthropic.com or a host on MUSHI_ANTHROPIC_BASE_URL_ALLOWLIST, and,
 * in local-only mode or with MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT=1, any private
 * host over http (Ollama's Messages API: `http://localhost:11434`).
 *
 * Thirty-odd call sites pass only `apiKey` to the Claude helpers, so key
 * resolution (`byok.ts`) remembers each Anthropic key's base URL here and the
 * client builders look it up by key. An explicit `baseUrl` always wins.
 *
 * The base URL is always passed explicitly: both SDKs would otherwise read
 * ANTHROPIC_BASE_URL themselves, unvalidated, and the AI SDK reads it as
 * `<root>/v1` while the Anthropic SDK reads it as the root.
 */

import { DEFAULT_ANTHROPIC_BASE_URL, validateAnthropicBaseUrl } from './byok-validation.ts'
import { withModelOverrides } from './llm-model-env.ts'

export { DEFAULT_ANTHROPIC_BASE_URL }

function env(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env?: { get(n: string): string | undefined } } }).Deno
  try {
    return deno?.env?.get(name)
  } catch {
    return undefined
  }
}

export function anthropicHostAllowlist(): string[] {
  return (env('MUSHI_ANTHROPIC_BASE_URL_ALLOWLIST') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
}

let warnedPlatform = false

/** The validated platform ANTHROPIC_BASE_URL root, or undefined (unset or refused, logged once). */
export function platformAnthropicBaseUrl(): string | undefined {
  const configured = env('ANTHROPIC_BASE_URL')?.trim()
  if (!configured) return undefined
  const v = validateAnthropicBaseUrl(configured, anthropicHostAllowlist())
  if (v.ok) return v.value
  if (!warnedPlatform) {
    warnedPlatform = true
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        scope: 'mushi:llm-endpoints',
        msg: 'Ignoring unsafe ANTHROPIC_BASE_URL platform configuration',
        reason: v.message,
      }),
    )
  }
  return undefined
}

const keyBaseUrls = new Map<string, string>()

/** Called by key resolution: this Anthropic key's calls go to `baseUrl` (undefined forgets it). */
export function rememberAnthropicBaseUrl(apiKey: string, baseUrl: string | undefined): void {
  if (!apiKey) return
  if (baseUrl) keyBaseUrls.set(apiKey, baseUrl)
  else keyBaseUrls.delete(apiKey)
}

/** The API root for a call: explicit, then the key's, then the platform's, then api.anthropic.com. */
export function anthropicBaseUrlFor(apiKey: string, explicit?: string): string {
  return explicit ?? keyBaseUrls.get(apiKey) ?? platformAnthropicBaseUrl() ?? DEFAULT_ANTHROPIC_BASE_URL
}

/**
 * Options for `createAnthropic` (AI SDK), whose baseURL includes `/v1`. An
 * undefined key stays undefined so the SDK still falls back to
 * ANTHROPIC_API_KEY, as the call sites relied on.
 */
export function anthropicAiSdkOptions(apiKey: string | undefined, explicitBaseUrl?: string): { apiKey?: string; baseURL: string } {
  return { ...(apiKey !== undefined ? { apiKey } : {}), baseURL: `${anthropicBaseUrlFor(apiKey ?? '', explicitBaseUrl)}/v1` }
}

/**
 * `createAnthropic(...)` with the right base URL and the operator's model
 * overrides: `localAnthropic(createAnthropic, key)(ANTHROPIC_HAIKU)` sends
 * MUSHI_LLM_MODEL_FAST when it is set.
 */
export function localAnthropic<P>(create: (opts: { apiKey?: string; baseURL: string }) => P, apiKey: string | undefined, explicitBaseUrl?: string): P {
  return withModelOverrides(create(anthropicAiSdkOptions(apiKey, explicitBaseUrl)))
}
