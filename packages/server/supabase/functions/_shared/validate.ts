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
 *   - `parseQuery(schema, url)` — same for URL query-string params.
 *   - Schemas live in this file (close to callers, easy to review).
 *   - Zod 4 (`npm:zod@4`) keeps the bundle small and types exact.
 *
 * USAGE:
 *   import { parseBody, ReportBodySchema } from '../_shared/validate.ts'
 *   const parsed = await parseBody(ReportBodySchema, req)
 *   if (parsed instanceof Response) return parsed  // 400
 *   const { projectId, description } = parsed.data
 */

// Deno-native zod 4 import (npm: specifier for Supabase Edge Runtime).
import { z } from 'npm:zod@4'

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

/** `functions/api/index.ts` — generic ingest endpoint */
export const ApiReportBodySchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  description: z.string().min(1, 'description is required').max(5_000),
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

export type ApiReportBody = z.infer<typeof ApiReportBodySchema>

/** `functions/classify-report/index.ts` — AI classification trigger */
export const ClassifyReportBodySchema = z.object({
  reportId: z.string().uuid('reportId must be a UUID'),
  projectId: z.string().min(1),
  force: z.boolean().optional(),
})

export type ClassifyReportBody = z.infer<typeof ClassifyReportBodySchema>

/** `functions/fast-filter/index.ts` — low-latency report triage */
export const FastFilterBodySchema = z.object({
  reportId: z.string().uuid('reportId must be a UUID'),
  projectId: z.string().min(1),
  description: z.string().min(1).max(5_000),
  category: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type FastFilterBody = z.infer<typeof FastFilterBodySchema>

/** `functions/qa-story-runner/index.ts` — execute a QA story */
export const QaStoryRunnerBodySchema = z.object({
  storyId: z.string().uuid('storyId must be a UUID'),
  projectId: z.string().min(1),
  runId: z.string().uuid('runId must be a UUID').optional(),
  options: z
    .object({
      maxSteps: z.number().int().min(1).max(200).optional(),
      timeout: z.number().int().min(1_000).max(300_000).optional(),
      captureScreenshots: z.boolean().optional(),
    })
    .optional(),
})

export type QaStoryRunnerBody = z.infer<typeof QaStoryRunnerBodySchema>

/** `functions/inventory-propose/index.ts` — propose inventory mutations */
export const InventoryProposeBodySchema = z.object({
  projectId: z.string().min(1),
  reportIds: z
    .array(z.string().uuid())
    .min(1, 'at least one reportId required')
    .max(50, 'max 50 reportIds per request'),
  proposalType: z
    .enum(['add', 'update', 'remove', 'merge'])
    .optional()
    .default('add'),
  context: z.string().max(2_000).optional(),
})

export type InventoryProposeBody = z.infer<typeof InventoryProposeBodySchema>
