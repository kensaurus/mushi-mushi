/**
 * FILE: packages/server/supabase/functions/_shared/structured-retry.ts
 * PURPOSE: One retry with a stricter instruction when a model's JSON misses
 *          the schema (Plan 023 Phase 1).
 *
 * Local OpenAI-compatible servers (llama.cpp, some Ollama and LM Studio
 * builds) silently ignore JSON Schema keywords they do not support, so a
 * classification can come back with a missing field or an off-enum value. The
 * AI SDK then throws NoObjectGeneratedError. Asking once more, with the rule
 * spelled out, recovers most of these; a second miss throws as before.
 * A reply cut off at the token limit is not retried: it would be cut again.
 *
 * Used by the classification calls on the AI SDK path (fast-filter,
 * classify-report's fallback). The Claude Messages path has its own retry in
 * claude-messages.ts.
 */

export const STRICT_JSON_RETRY_INSTRUCTION =
  'Your previous reply did not match the required JSON schema. Reply again with ONLY one JSON object that matches the schema exactly: every required field present, no extra fields, enum values copied exactly, no markdown fences, no prose.'

/** True for the AI SDK's NoObjectGeneratedError when the reply was not truncated. */
export function isRetryableSchemaMiss(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { name?: unknown; finishReason?: unknown }
  return e.name === 'AI_NoObjectGeneratedError' && e.finishReason !== 'length'
}

/** Append the retry instruction to a system prompt. */
export function withStrictJsonInstruction(system: string | undefined): string {
  return system ? `${system}\n\n${STRICT_JSON_RETRY_INSTRUCTION}` : STRICT_JSON_RETRY_INSTRUCTION
}

/**
 * Run `attempt(undefined)`; on a schema miss, run `attempt(instruction)` once.
 * The caller appends the instruction to its system prompt.
 */
export async function retryOnSchemaMiss<T>(
  attempt: (strictInstruction: string | undefined) => Promise<T>,
  onRetry?: (err: unknown) => void,
): Promise<T> {
  try {
    return await attempt(undefined)
  } catch (err) {
    if (!isRetryableSchemaMiss(err)) throw err
    onRetry?.(err)
    return await attempt(STRICT_JSON_RETRY_INSTRUCTION)
  }
}
