/**
 * FILE: packages/server/supabase/functions/_shared/fix-attempt-create.ts
 * PURPOSE: The row POST /v1/admin/fixes inserts. `mushi work` sends
 *          agent `local-cursor` and the model it ran; other callers are unchanged.
 */

export function newFixAttemptRow(
  body: { agent?: unknown; llm_model?: unknown },
  report: { id: string; project_id: string },
): { report_id: string; project_id: string; agent: unknown; status: 'pending'; llm_model?: string } {
  const raw = typeof body.llm_model === 'string' ? body.llm_model.trim() : ''
  const llm_model = raw ? raw.slice(0, 200) : ''
  return {
    report_id: report.id,
    project_id: report.project_id,
    agent: body.agent ?? 'claude_code',
    status: 'pending',
    ...(llm_model ? { llm_model } : {}),
  }
}
