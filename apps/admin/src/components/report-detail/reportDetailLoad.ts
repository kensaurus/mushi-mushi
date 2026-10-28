/**
 * FILE: reportDetailLoad.ts
 * PURPOSE: Split the report page's first paint from the code-index lookup.
 *
 * GET /v1/admin/reports/:id awaits buildReportFixPacket, which embeds the
 * summary against the code index. createEmbedding retries 429/5xx for up to
 * ~15s (embeddings.ts), and the page renders nothing until that returns.
 * The console asks with ?rag=0 so the row, classification and fix attempts
 * come back without that wait. Code quotes still arrive from
 * GET …/fix-context, whose field is `fix_prompt` (the detail route calls
 * the same string `fix_packet`). MCP and the CLI omit rag=0 and keep the
 * full packet on the detail response.
 */

/** Detail GET for the console. Skips the code-index embedding. */
export function reportDetailRequestPath(id: string): string {
  return `/v1/admin/reports/${id}?rag=0`
}

/** Follow-up that still runs the code-index lookup. */
export function reportFixContextRequestPath(id: string): string {
  return `/v1/admin/reports/${id}/fix-context`
}

/**
 * The composed packet on the fix-context route. Reading `fix_packet` here
 * returns nothing: that name is only on the detail response.
 */
export function fixPacketFromFixContext(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const prompt = (data as { fix_prompt?: unknown }).fix_prompt
  if (typeof prompt !== 'string' || !prompt.trim()) return null
  return prompt
}
