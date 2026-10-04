/**
 * FILE: _shared/project-llm-key.ts
 * PURPOSE: The key a background job uses for one project: the project's own
 *          (BYOK) key when it has one, else the platform key — the same order
 *          as every request path (`resolveLlmKey`).
 *
 * Until 2026-10-04 generate-synthetic, mistake-clusterer, mistake-summarizer
 * and release-builder read ANTHROPIC_API_KEY / OPENAI_API_KEY straight from the
 * environment, so a customer's own key was ignored and every call landed on
 * the platform account.
 *
 * A project over its monthly AI budget gets `null` instead of a thrown
 * LlmBudgetExceededError: a batch job skips that project and carries on with
 * the rest, which is what the budget is for.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { resolveLlmKey, type LlmProvider, type ResolvedKey } from './byok.ts'
import { LlmBudgetExceededError } from './llm-budget.ts'

export async function projectLlmKey(
  db: SupabaseClient,
  projectId: string,
  provider: LlmProvider,
): Promise<ResolvedKey | null> {
  try {
    return await resolveLlmKey(db, projectId, provider)
  } catch (err) {
    if (err instanceof LlmBudgetExceededError) return null
    throw err
  }
}
