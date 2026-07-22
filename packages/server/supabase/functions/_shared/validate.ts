/**
 * FILE: _shared/validate.ts
 * PURPOSE: Zod-backed request validation helpers for Supabase Edge Functions.
 *
 * WHY: Before this, the 5 highest-exposure REST edge functions used hand-rolled
 * `typeof body.x === 'string'` guards that silently coerced bad types or
 * accepted `undefined` where a required field was missing.  This module gives
 * every function a typed 400-body with structured field errors so callers get
 * machine-readable failure reasons rather than opaque 500s.
 *
 * DESIGN:
 *   - `parseBody(schema, req)` — parse + validate JSON body; returns `{ ok,
 *     data }` on success or a `Response` with HTTP 400 + structured error JSON
 *     on failure.  Never throws.
 *   - `safeParse(schema, raw)` — validate an already-parsed object; useful for
 *     Hono routes (c.req.json() already consumed the stream) or try/catch
 *     patterns where the body is parsed conditionally.
 *   - `parseQuery(schema, url)` — same for URL query-string params.
 *   - Schemas live in this file (close to callers, easy to review).
 *   - Zod 3 (`npm:zod@3`) for consistency with classify-report / fast-filter.
 *
 * USAGE (stream-based):
 *   import { parseBody, ClassifyReportBodySchema } from '../_shared/validate.ts'
 *   const parsed = await parseBody(ClassifyReportBodySchema, req)
 *   if (parsed instanceof Response) return parsed  // 400
 *   const { reportId, projectId } = parsed.data
 *
 * USAGE (already-parsed, e.g. Hono):
 *   import { safeParse, ApiReportBodySchema } from '../_shared/validate.ts'
 *   const body = await c.req.json()
 *   const validation = safeParse(ApiReportBodySchema, body)
 *   if (validation instanceof Response) return validation  // 400
 *   // pass original `body` to ingestReport (validate-only, never replace)
 */

// Deno-native zod 3 import (npm: specifier for Supabase Edge Runtime).
// Using zod@3 (not zod@4) for consistency with classify-report / fast-filter
// which also pin to npm:zod@3 — avoids dual-version bloat in the edge bundle.
import { z } from 'npm:zod@3'

// ─── helpers ─────────────────────────────────────────────────────────────────

export type ZodSchema<T> = z.ZodType<T>

/** Structured error body returned on HTTP 400. */
export interface ValidationErrorBody {
  error: 'VALIDATION_ERROR'
  message: string
  fields: Array<{ path: string; message: string }>
}

function zodErrorToFields(err: z.ZodError): Array<{ path: string; message: string }> {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
}

function validationErrorResponse(err: z.ZodError): Response {
  const body: ValidationErrorBody = {
    error: 'VALIDATION_ERROR',
    message: `Request body failed validation: ${err.issues.map((i) => i.message).join('; ')}`,
    fields: zodErrorToFields(err),
  }
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Validate an already-parsed value against a schema.
 *
 * Use this when the request body stream has already been consumed (Hono's
 * `c.req.json()`, or a conditional try/catch parse pattern).
 * Returns `{ ok: true, data }` on success or a `Response` (HTTP 400) on error.
 */
export function safeParse<T>(
  schema: ZodSchema<T>,
  raw: unknown,
): { ok: true; data: T } | Response {
  const result = schema.safeParse(raw)
  if (!result.success) return validationErrorResponse(result.error)
  return { ok: true, data: result.data }
}

/**
 * Parse and validate the JSON body of a `Request`.
 *
 * Returns `{ ok: true, data }` on success.
 * Returns a `Response` (HTTP 400) on parse failure or validation error.
 * Never throws — catches malformed JSON and content-type mismatches.
 */
export async function parseBody<T>(
  schema: ZodSchema<T>,
  req: Request,
): Promise<{ ok: true; data: T } | Response> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return new Response(
      JSON.stringify({
        error: 'VALIDATION_ERROR',
        message: 'Request body must be valid JSON',
        fields: [],
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const result = schema.safeParse(raw)
  if (!result.success) return validationErrorResponse(result.error)
  return { ok: true, data: result.data }
}

/**
 * Parse and validate URL search params.
 *
 * Params are passed in as an object of string values (URL.searchParams).
 * Returns `{ ok: true, data }` on success or a `Response` (HTTP 400) on error.
 */
export function parseQuery<T>(
  schema: ZodSchema<T>,
  url: URL,
): { ok: true; data: T } | Response {
  const params: Record<string, string> = {}
  url.searchParams.forEach((v, k) => { params[k] = v })

  const result = schema.safeParse(params)
  if (!result.success) return validationErrorResponse(result.error)
  return { ok: true, data: result.data }
}

// ─── Per-function schemas ──────────────────────────────────────────────────
//
// Each schema is named after the edge function it validates.
// Keep them here (not inside the function files) so they can be unit-tested
// without invoking a Deno runtime.

/**
 * `functions/api/routes/public.ts` — `/v1/reports` SDK ingest endpoint.
 *
 * IMPORTANT — wire as validate-only, never replace `body` passed to ingestReport:
 * The SDK sends many additional fields (console_logs, breadcrumbs, screenshot_url,
 * performance_metrics, replay_events, …) not listed here.  `.passthrough()` ensures
 * unknown keys are preserved, but the body passed downstream must be the original
 * parsed object, not `validation.data`.
 *
 * `projectId` is optional because callers who authenticate via API key may omit it
 * (the project is derived from the key).  When present it is validated against the
 * auth-key project and mismatches are rejected separately.
 */
export const ApiReportBodySchema = z
  .object({
    projectId: z.string().min(1).optional(),
    description: z.string().max(5_000).optional(),
    category: z.enum(['bug', 'feedback', 'question', 'feature', 'other']).optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    environment: z
      .object({
        url: z.string(),
        userAgent: z.string().optional(),
        platform: z.string().optional(),
        language: z.string().optional(),
        timezone: z.string().optional(),
        viewport: z
          .object({ width: z.number(), height: z.number() })
          .optional(),
        referrer: z.string().optional(),
        timestamp: z.string().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    reporterToken: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    sdkPackage: z.string().optional(),
  })
  .passthrough()

export type ApiReportBody = z.infer<typeof ApiReportBodySchema>

/**
 * `functions/classify-report/index.ts` — AI classification trigger (internal pipeline).
 *
 * Called by `fast-filter` with service-role key.  Required fields: `reportId`,
 * `projectId`.  Additional pipeline fields (`stage1Extraction`, `evidence`, `airGap`,
 * `force`) are preserved via `.passthrough()`.
 */
export const ClassifyReportBodySchema = z
  .object({
    reportId: z.string().uuid('reportId must be a UUID'),
    projectId: z.string().min(1),
    force: z.boolean().optional(),
    // Internal pipeline fields — typed loosely; passthrough covers the rest.
    stage1Extraction: z.unknown().optional(),
    evidence: z.unknown().optional(),
    airGap: z.boolean().optional(),
  })
  .passthrough()

export type ClassifyReportBody = z.infer<typeof ClassifyReportBodySchema>

/**
 * `functions/fast-filter/index.ts` — low-latency report triage (internal pipeline).
 *
 * Called by `api` with service-role key.  `description` is fetched from the DB
 * inside fast-filter, so it is optional here.  `.passthrough()` preserves any
 * additional pipeline fields.
 */
export const FastFilterBodySchema = z
  .object({
    reportId: z.string().uuid('reportId must be a UUID'),
    projectId: z.string().min(1),
    description: z.string().max(5_000).optional(),
    category: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

export type FastFilterBody = z.infer<typeof FastFilterBodySchema>

/**
 * `functions/qa-story-runner/index.ts` — cron/manual QA story executor.
 *
 * All fields optional — the function is invoked both by pg_cron (no body) and
 * by manual triggers from the API route (JSON body with snake_case keys).
 * When the body is absent or non-JSON the function runs as a cron sweep.
 */
export const QaStoryRunnerBodySchema = z
  .object({
    trigger: z.string().optional(),
    story_id: z.string().uuid('story_id must be a UUID').optional(),
    run_id: z.string().uuid('run_id must be a UUID').optional(),
  })
  .passthrough()

export type QaStoryRunnerBody = z.infer<typeof QaStoryRunnerBodySchema>

/**
 * `functions/inventory-propose/index.ts` — propose inventory mutations.
 *
 * Called with service-role key by pg_cron and manually by the API route.
 * All fields optional — when `mode` is `'drift_watch'` no `project_id` is
 * required (the function scans all projects).
 */
export const InventoryProposeBodySchema = z
  .object({
    project_id: z.string().min(1).optional(),
    triggered_by: z.string().optional(),
    model: z.string().optional(),
    mode: z.enum(['single', 'drift_watch']).optional(),
  })
  .passthrough()

export type InventoryProposeBody = z.infer<typeof InventoryProposeBodySchema>
