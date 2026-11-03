/**
 * Model id stored on fix_attempts.llm_model when a run is registered.
 * Anything else (spaces, quotes) is dropped rather than saved.
 */
export function cleanLlmModel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim()
  if (!/^[\w.@:/+-]{1,120}$/.test(m)) return null
  return m
}
