/**
 * Names a fix attempt on the report page.
 *
 * `fix_attempts.agent` stays `mcp` for a run on someone's machine (`mushi work`
 * and `submit_fix_result`): the reaper and local follow-ups key on that word.
 * It is the transport, not the Cursor model. The model is `llm_model`.
 */

const LOCAL_ATTEMPT_AGENT = 'mcp'

export function reportAttemptLabels(attempt: {
  agent?: string | null
  llm_model?: string | null
  branch?: string | null
}): { agent: string | null; model: string | null } {
  const rawAgent = attempt.agent?.trim() || null
  const rawModel = attempt.llm_model?.trim() || null
  const model = rawModel && rawModel.toLowerCase() !== LOCAL_ATTEMPT_AGENT ? rawModel : null
  if (rawAgent !== LOCAL_ATTEMPT_AGENT) return { agent: rawAgent, model }
  // A model, or the branch `mushi work` opens (`…-local-cursor`), means the
  // local Cursor CLI. A bare `mcp` row can also be `submit_fix_result`.
  const localCursor = Boolean(model) || (attempt.branch ?? '').includes('-local-cursor')
  return { agent: localCursor ? 'Local Cursor' : 'Local agent', model }
}

/** "via Local Cursor · grok-4.7", or null when the attempt names neither. */
export function attemptVia(attempt: {
  agent?: string | null
  llm_model?: string | null
  branch?: string | null
}): string | null {
  const named = reportAttemptLabels(attempt)
  if (!named.agent && !named.model) return null
  if (named.agent && named.model) return `via ${named.agent} · ${named.model}`
  return `via ${named.agent ?? named.model}`
}
