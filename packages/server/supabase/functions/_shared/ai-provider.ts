/**
 * FILE: packages/server/supabase/functions/_shared/ai-provider.ts
 * PURPOSE: Which model family an app's AI work runs on (ADR 0039 amendment,
 *          2026-10-31): its organization's `ai_provider`, 'anthropic' (the
 *          default: Claude first, OpenAI as the fallback) or 'openai' (no
 *          Claude key is handed out at all).
 *
 *          The owner switched to OpenAI when the Claude credits ran low. Only
 *          pausing the Claude key was not enough: the resolver then reached
 *          the app's legacy Claude field and the platform's ANTHROPIC_API_KEY,
 *          and eight call sites read that env key directly. So the switch is
 *          enforced in `resolveLlmKeys` and in `platformAnthropicKey`, which
 *          those call sites use instead of the env var.
 *
 * A failed read keeps the default ('anthropic'): one unreadable row must not
 * move an organization's spend to another vendor.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

export type AiProvider = 'anthropic' | 'openai'
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai']

const TTL_MS = 60_000
const cache = new Map<string, { value: AiProvider; at: number }>()

/** The app's organization's choice; 'anthropic' when unset or unreadable. Cached for a minute per app. */
export async function aiProviderForProject(db: SupabaseClient, projectId: string, now = Date.now()): Promise<AiProvider> {
  const hit = cache.get(projectId)
  if (hit && now - hit.at < TTL_MS) return hit.value
  let value: AiProvider = 'anthropic'
  try {
    const { data, error } = await db.from('projects').select('organizations(ai_provider)').eq('id', projectId).maybeSingle()
    const org = (data as { organizations?: { ai_provider?: string | null } | Array<{ ai_provider?: string | null }> | null } | null)?.organizations
    const raw = Array.isArray(org) ? org[0]?.ai_provider : org?.ai_provider
    if (!error && raw === 'openai') value = 'openai'
  } catch {
    // Keep the default.
  }
  cache.set(projectId, { value, at: now })
  return value
}

/** Forget cached choices (after the console changes one, and in tests). */
export function clearAiProviderCache(): void {
  cache.clear()
}

/**
 * The platform's ANTHROPIC_API_KEY for this app, or undefined when its
 * organization runs AI on OpenAI. Use it instead of reading the env var.
 */
export async function platformAnthropicKey(db: SupabaseClient, projectId: string): Promise<string | undefined> {
  if ((await aiProviderForProject(db, projectId)) === 'openai') return undefined
  return typeof Deno !== 'undefined' ? Deno.env.get('ANTHROPIC_API_KEY') || undefined : undefined
}
