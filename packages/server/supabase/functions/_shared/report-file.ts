/**
 * FILE: packages/server/supabase/functions/_shared/report-file.ts
 * PURPOSE: Filing a free-form report from the console, the CLI (`mushi
 *          reports file`) or MCP (`file_report`) through
 *          POST /v1/admin/projects/:id/reports: the request schema and the
 *          `reports` row it becomes. Before this, backlog items were filed
 *          through the SDK ingest route (`POST /v1/reports`) with a project
 *          API key, which the CLI and MCP do not hold for every app.
 *
 * The filed report goes through the normal triage (stage-1 queue + fast-filter),
 * so it gets a diagnosis like any other report. A severity or component given
 * here is the filer's hint; triage may refine it.
 *
 * Pure: no Deno globals, so vitest imports it directly.
 */

import { z } from 'npm:zod@3'

/** The severities reports use (live values: critical, high, medium, low). */
export const FILED_REPORT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type FiledReportSeverity = (typeof FILED_REPORT_SEVERITIES)[number]

/**
 * What kind of issue it is: the widget's own categories (bug, slow, visual,
 * confusing, other), so a report filed from the console reads like one a user
 * sent. Triage may refine it.
 */
export const FILED_REPORT_CATEGORIES = ['bug', 'slow', 'visual', 'confusing', 'other'] as const
export type FiledReportCategory = (typeof FILED_REPORT_CATEGORIES)[number]

/** Reports one app may file through this route per hour (console, CLI and MCP together). */
export const FILED_REPORTS_PER_HOUR = 30
export const FILE_REPORT_RATE_SCOPE = 'admin_report_file'

/** Control characters except tab and newline. */
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function clean(text: string): string {
  return text.replace(CONTROL_RE, '').replace(/\r\n?/g, '\n').trim()
}

export const fileReportSchema = z
  .object({
    title: z.string().transform(clean).pipe(z.string().min(3, 'title needs at least 3 characters').max(200, 'title is at most 200 characters')),
    description: z
      .string()
      .transform(clean)
      .pipe(z.string().min(1, 'description is required').max(10_000, 'description is at most 10000 characters')),
    severity: z.enum(FILED_REPORT_SEVERITIES).optional(),
    category: z.enum(FILED_REPORT_CATEGORIES).optional(),
    component: z
      .string()
      .transform(clean)
      .pipe(z.string().max(200, 'component is at most 200 characters'))
      .optional(),
    // Put the filed report first in one of the caller's local worker lanes
    // (ADR 0048): the lane must serve this app and belong to the caller.
    queue: z.object({ laneId: z.string().uuid('queue.laneId must be a lane id') }).strict().optional(),
  })
  .strict()

export type FileReportInput = z.infer<typeof fileReportSchema>

export type FileReportParse =
  | { ok: true; value: FileReportInput }
  | { ok: false; error: { code: 'VALIDATION_ERROR'; message: string } }

/** Validate a request body; the message names each bad field. */
export function parseFileReportBody(body: unknown): FileReportParse {
  const parsed = fileReportSchema.safeParse(body ?? {})
  if (parsed.success) return { ok: true, value: parsed.data }
  const message = parsed.error.issues
    .map((i) => (i.path.length > 0 ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ')
  return { ok: false, error: { code: 'VALIDATION_ERROR', message } }
}

/** How the report was filed, for the report's metadata and the audit log. */
export type FiledVia = 'console' | 'api_key'

/** The `reports` row a filed report becomes (source 'api', status 'new'). */
export function filedReportRow(
  input: FileReportInput,
  ctx: { reportId: string; projectId: string; actorId: string; via: FiledVia; now: Date },
): Record<string, unknown> {
  const at = ctx.now.toISOString()
  const component = input.component ? input.component : null
  return {
    id: ctx.reportId,
    project_id: ctx.projectId,
    title: input.title,
    description: input.description,
    category: input.category ?? 'other',
    user_category: input.category ?? 'other',
    ...(input.severity ? { severity: input.severity } : {}),
    ...(component ? { component } : {}),
    environment: { platform: 'manual' },
    custom_metadata: {
      source: 'admin_file',
      filed_via: ctx.via,
      filed_by: ctx.actorId,
      ...(input.severity ? { filed_severity: input.severity } : {}),
      ...(component ? { filed_component: component } : {}),
    },
    status: 'new',
    source: 'api',
    // NOT NULL; a filed report has no SDK reporter token.
    reporter_token_hash: 'admin-filed',
    reporter_user_id: ctx.actorId,
    synced_at: at,
    created_at: at,
  }
}
