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
 * move an organization's spend to another vendor. It logs a warning and is not
 * cached. The read used to be one PostgREST embed,
 * `projects?select=organizations(ai_provider)`. On 2026-11-17 the ops_mutes
 * junction made that embed ambiguous (PGRST201), every read failed without a
 * word, and the OpenAI organization ran Claude on its own keys. So the read is
 * two plain selects.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { anthropicNoCreditDrill, hostedClaudeFirst } from './hosted-llm-order.ts'

const log = rootLog.child('ai-provider')

export type AiProvider = 'anthropic' | 'openai'
export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai']

const TTL_MS = 60_000
const cache = new Map<string, { value: AiProvider; at: number }>()

/** The app's organization's choice; 'anthropic' when unset or unreadable. Cached for a minute per app. */
export async function aiProviderForProject(db: SupabaseClient, projectId: string, now = Date.now()): Promise<AiProvider> {
  const hit = cache.get(projectId)
  if (hit && now - hit.at < TTL_MS) return hit.value
  try {
    const value = await readAiProvider(db, projectId)
    cache.set(projectId, { value, at: now })
    return value
  } catch (err) {
    log.warn('AI provider unreadable; keeping the default', {
      projectId,
      default: 'anthropic',
      err: err instanceof Error ? err.message : String(err),
    })
    return 'anthropic'
  }
}

/** Two plain selects, no embed (see the header). Throws on a failed read. */
async function readAiProvider(db: SupabaseClient, projectId: string): Promise<AiProvider> {
  const project = await db.from('projects').select('organization_id').eq('id', projectId).maybeSingle()
  if (project.error) throw new Error(`projects read failed: ${project.error.message}`)
  const organizationId = (project.data as { organization_id?: string | null } | null)?.organization_id
  if (!organizationId) return 'anthropic'
  const org = await db.from('organizations').select('ai_provider').eq('id', organizationId).maybeSingle()
  if (org.error) throw new Error(`organizations read failed: ${org.error.message}`)
  return (org.data as { ai_provider?: string | null } | null)?.ai_provider === 'openai' ? 'openai' : 'anthropic'
}

/** Forget cached choices (after the console changes one, and in tests). */
export function clearAiProviderCache(): void {
  cache.clear()
}

/**
 * The platform's ANTHROPIC_API_KEY for this app, or undefined when its
 * organization runs AI on OpenAI, or when MUSHI_HOSTED_LLM_ORDER does not put
 * Anthropic first (hosted-llm-order.ts; the default since 2026-11-21 is
 * OpenAI first). Use it instead of reading the env var: a caller that gets
 * undefined takes its OpenAI branch.
 */
export async function platformAnthropicKey(db: SupabaseClient, projectId: string): Promise<string | undefined> {
  if (!hostedClaudeFirst() || anthropicNoCreditDrill()) return undefined
  if ((await aiProviderForProject(db, projectId)) === 'openai') return undefined
  return typeof Deno !== 'undefined' ? Deno.env.get('ANTHROPIC_API_KEY') || undefined : undefined
}
