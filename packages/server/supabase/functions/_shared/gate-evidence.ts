/**
 * FILE: packages/server/supabase/functions/_shared/gate-evidence.ts
 * PURPOSE: Validate the evidence a CI run hands POST /inventory/:id/gates/run
 *          before it is forwarded to inventory-gates.
 *
 * mcp-ci sends lint findings (dead_handler / mock_leak, from the customer's
 * ESLint report), `discover-api`'s route list and `spec-drift`'s oasdiff
 * output. The proxy used to drop all three, so those gates always saw
 * nothing and passed (Mushi report 67f40c20). The input is customer-supplied,
 * so shapes and list sizes are checked and long strings are cut.
 */

import { z } from 'npm:zod@3'

const MAX_ITEMS = 2_000
const MAX_APIS = 5_000

const severity = z.enum(['info', 'warn', 'error'])
/** Long text is cut, not refused: oasdiff can fall back to a whole JSON item as the message. */
const text = (max: number) => z.string().transform((s) => s.slice(0, max))
const message = z.string().transform((s) => s.slice(0, 2_000) || '(no message)')

const lintFinding = z.object({
  gate: z.enum(['dead_handler', 'mock_leak']),
  severity,
  rule_id: text(200).optional(),
  message,
  file_path: text(1_000).optional(),
  line: z.number().int().nonnegative().optional(),
  col: z.number().int().nonnegative().optional(),
  node_id: z.string().max(200).nullable().optional(),
  suggested_fix: z.record(z.unknown()).optional(),
})

const specDiffFinding = z.object({
  severity,
  rule_id: text(200).optional(),
  message,
  path: text(1_000).optional(),
  method: text(20).optional(),
})

const evidence = z.object({
  findings: z.array(lintFinding).max(MAX_ITEMS).optional(),
  discovered_apis: z.array(text(500)).max(MAX_APIS).optional(),
  spec_diff_findings: z.array(specDiffFinding).max(MAX_ITEMS).optional(),
})

export type GateEvidence = z.infer<typeof evidence>

/** The evidence fields present in the body, validated; or a plain reason they were refused. */
export function gateEvidenceFromBody(
  body: Record<string, unknown>,
): { ok: true; fields: GateEvidence } | { ok: false; message: string } {
  const parsed = evidence.safeParse({
    findings: body.findings,
    discovered_apis: body.discovered_apis,
    spec_diff_findings: body.spec_diff_findings,
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, message: `${issue.path.join('.') || 'body'}: ${issue.message}` }
  }
  const fields: GateEvidence = {}
  if (parsed.data.findings) fields.findings = parsed.data.findings
  if (parsed.data.discovered_apis) fields.discovered_apis = parsed.data.discovered_apis
  if (parsed.data.spec_diff_findings) fields.spec_diff_findings = parsed.data.spec_diff_findings
  return { ok: true, fields }
}
