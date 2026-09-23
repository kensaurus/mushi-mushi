/**
 * FILE: packages/server/supabase/functions/api/routes/events-admin.ts
 * PURPOSE: Users & Funnels read API over product_events
 *          (docs/plan-gtm.md → Workstream A, week 2). Thin Zod + ownership
 *          layer over the five RPCs in 20260921000004_product_events_rpcs.sql.
 *
 *   GET /v1/admin/events/summary?window=30
 *   GET /v1/admin/events/funnel?steps=a,b,c&from=ISO&to=ISO&window=7d&breakdown=prop
 *   GET /v1/admin/events/paths?from_event=&from=&to=&limit=
 *   GET /v1/admin/events/people?filter=<urlencoded json>&limit=&before=
 *   GET /v1/admin/events/retention?weeks=&return_event=
 *
 * Project resolution is exactly GET /v1/admin/activity's: resolveOwnedProject
 * (X-Mushi-Project-Id / ?project_id, else the caller's first project; API-key
 * callers are pinned to the key's project). Not owned → 404. summary, funnel
 * and paths also accept a project API key with mcp:read (adminOrApiKey) so
 * the MCP tools can call them; people and retention are console-only.
 *
 * Response: { ok: true, data: <rpc jsonb> }. Validation → 400 with the first
 * Zod issue; RPC failure → rpcError (500, reported to Sentry).
 */

import type { Context, Hono } from 'npm:hono@4';
import { z } from 'npm:zod@3';
import type { Variables } from '../types.ts';
import { adminOrApiKey, jwtAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { resolveOwnedProject, rpcError } from '../shared.ts';

// Same vocabulary the ingest route and the SQL CHECK enforce.
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
// Property keys: taxonomy keys plus the reserved `$`-prefixed ones.
export const PROPERTY_KEY_RE = /^\$?[a-z][a-z0-9_]{0,63}$/;

export const FUNNEL_WINDOWS = {
  '1h': '1 hour',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
} as const;
export type FunnelWindow = keyof typeof FUNNEL_WINDOWS;

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const MAX_FILTER_KEYS = 20;
const MAX_FILTER_VALUE_LEN = 256;

type Db = ReturnType<typeof getServiceClient>;

// ── Query schemas (exported for api/routes/events-admin.test.ts) ─────────────

const isoDate = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() ? new Date(v) : v),
  z.date({ invalid_type_error: 'must be an ISO-8601 timestamp' }).refine((d) => !Number.isNaN(d.getTime()), {
    message: 'must be an ISO-8601 timestamp',
  }),
);

export const summaryQuerySchema = z.object({
  window: z.coerce.number().int().min(1).max(365).default(DEFAULT_RANGE_DAYS),
});

/** "a,b,c" → ['a','b','c']; 1..8 distinct valid event names. */
export const funnelStepsSchema = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
  .pipe(
    z
      .array(z.string().regex(EVENT_NAME_RE, 'steps must be snake_case event names'))
      .min(1, 'steps requires at least 1 event')
      .max(8, 'steps accepts at most 8 events')
      .refine((steps) => new Set(steps).size === steps.length, { message: 'steps must be distinct' }),
  );

export const funnelQuerySchema = z.object({
  steps: funnelStepsSchema,
  from: isoDate.optional(),
  to: isoDate.optional(),
  window: z.enum(['1h', '1d', '7d', '30d']).default('7d'),
  breakdown: z.string().regex(PROPERTY_KEY_RE, 'breakdown must be a property key').optional(),
});

export const pathsQuerySchema = z.object({
  from_event: z.string().regex(EVENT_NAME_RE, 'from_event must be a snake_case event name'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * People filter: a flat JSON object of scalar trait values, applied as
 * `traits @> filter`. Nested objects / arrays are rejected so a caller cannot
 * turn the containment test into an unbounded jsonb match.
 */
export const peopleFilterSchema = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw || !raw.trim()) return {} as Record<string, string | number | boolean | null>;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filter must be URL-encoded JSON' });
      return z.NEVER;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'filter must be a JSON object' });
      return z.NEVER;
    }
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length > MAX_FILTER_KEYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `filter accepts at most ${MAX_FILTER_KEYS} keys` });
      return z.NEVER;
    }
    const out: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of entries) {
      if (!PROPERTY_KEY_RE.test(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `filter key "${key}" is not a trait key` });
        return z.NEVER;
      }
      if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        out[key] = value;
      } else if (typeof value === 'string' && value.length <= MAX_FILTER_VALUE_LEN) {
        out[key] = value;
      } else {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `filter value for "${key}" must be a short scalar` });
        return z.NEVER;
      }
    }
    return out;
  });

export const peopleQuerySchema = z.object({
  filter: peopleFilterSchema,
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: isoDate.optional(),
});

export const retentionQuerySchema = z.object({
  weeks: z.coerce.number().int().min(1).max(26).default(8),
  return_event: z.string().regex(EVENT_NAME_RE, 'return_event must be a snake_case event name').optional(),
});

/** from defaults to now − 30 d, to defaults to now; from < to; ≤ 365 d. */
export function resolveRange(
  from: Date | undefined,
  to: Date | undefined,
  now: Date = new Date(),
): { from: Date; to: Date } | { error: string } {
  const resolvedTo = to ?? now;
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  if (resolvedFrom.getTime() >= resolvedTo.getTime()) return { error: 'from must be before to' };
  if (resolvedTo.getTime() - resolvedFrom.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    return { error: `range must be at most ${MAX_RANGE_DAYS} days` };
  }
  return { from: resolvedFrom, to: resolvedTo };
}

// ── Route plumbing ───────────────────────────────────────────────────────────

function validationError(c: Context, message: string): Response {
  return c.json({ ok: false, error: { code: 'VALIDATION_ERROR', message } }, 400);
}

function parseQuery<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): { ok: true; value: z.infer<T> } | { ok: false; response: Response } {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, response: validationError(c, `${path}${issue?.message ?? 'invalid query'}`) };
  }
  return { ok: true, value: parsed.data };
}

/** Same resolution as GET /v1/admin/activity (dashboard.ts). */
async function resolveProject(
  c: Context,
  db: Db,
): Promise<{ ok: true; projectId: string } | { ok: false; response: Response }> {
  const userId = c.get('userId') as string;
  const resolved = await resolveOwnedProject(c, db, userId, {
    noProjectResponse: () =>
      c.json({ ok: false, error: { code: 'NO_PROJECT', message: 'No project found for this account' } }, 404),
  });
  if ('response' in resolved) return { ok: false, response: resolved.response };
  return { ok: true, projectId: resolved.project.id as string };
}

export function registerEventsAdminRoutes(app: Hono<{ Variables: Variables }>): void {
  // ─── GET /v1/admin/events/summary?window=30 ────────────────────────────────
  app.get('/v1/admin/events/summary', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const q = parseQuery(c, summaryQuerySchema);
    if (!q.ok) return q.response;
    const db = getServiceClient();
    const project = await resolveProject(c, db);
    if (!project.ok) return project.response;

    const { data, error } = await db.rpc('product_events_summary', {
      p_project_id: project.projectId,
      p_window_days: q.value.window,
    });
    if (error) return rpcError(c, error);
    return c.json({ ok: true, data });
  });

  // ─── GET /v1/admin/events/funnel?steps=a,b,c&from=&to=&window=7d&breakdown= ─
  app.get('/v1/admin/events/funnel', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const q = parseQuery(c, funnelQuerySchema);
    if (!q.ok) return q.response;
    const range = resolveRange(q.value.from, q.value.to);
    if ('error' in range) return validationError(c, range.error);
    const db = getServiceClient();
    const project = await resolveProject(c, db);
    if (!project.ok) return project.response;

    const { data, error } = await db.rpc('product_funnel', {
      p_project_id: project.projectId,
      p_steps: q.value.steps,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_window: FUNNEL_WINDOWS[q.value.window],
      p_breakdown: q.value.breakdown ?? null,
    });
    if (error) {
      // 22023 = the RPC's own argument checks (steps count/distinct/window).
      if (error.code === '22023') return validationError(c, error.message);
      return rpcError(c, error);
    }
    return c.json({
      ok: true,
      data: {
        ...(data as Record<string, unknown>),
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        window: q.value.window,
      },
    });
  });

  // ─── GET /v1/admin/events/paths?from_event=&from=&to=&limit= ───────────────
  app.get('/v1/admin/events/paths', adminOrApiKey({ scope: 'mcp:read' }), async (c) => {
    const q = parseQuery(c, pathsQuerySchema);
    if (!q.ok) return q.response;
    const range = resolveRange(q.value.from, q.value.to);
    if ('error' in range) return validationError(c, range.error);
    const db = getServiceClient();
    const project = await resolveProject(c, db);
    if (!project.ok) return project.response;

    const { data, error } = await db.rpc('product_paths', {
      p_project_id: project.projectId,
      p_from_event: q.value.from_event,
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_limit: q.value.limit,
    });
    if (error) return rpcError(c, error);
    return c.json({
      ok: true,
      data: {
        ...(data as Record<string, unknown>),
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    });
  });

  // ─── GET /v1/admin/events/people?filter=&limit=&before= (console only) ─────
  app.get('/v1/admin/events/people', jwtAuth, async (c) => {
    const q = parseQuery(c, peopleQuerySchema);
    if (!q.ok) return q.response;
    const db = getServiceClient();
    const project = await resolveProject(c, db);
    if (!project.ok) return project.response;

    const { data, error } = await db.rpc('product_people', {
      p_project_id: project.projectId,
      p_filter: q.value.filter,
      p_limit: q.value.limit,
      p_before: q.value.before ? q.value.before.toISOString() : null,
    });
    if (error) return rpcError(c, error);
    return c.json({ ok: true, data });
  });

  // ─── GET /v1/admin/events/retention?weeks=&return_event= (console only) ────
  app.get('/v1/admin/events/retention', jwtAuth, async (c) => {
    const q = parseQuery(c, retentionQuerySchema);
    if (!q.ok) return q.response;
    const db = getServiceClient();
    const project = await resolveProject(c, db);
    if (!project.ok) return project.response;

    const { data, error } = await db.rpc('product_retention', {
      p_project_id: project.projectId,
      p_weeks: q.value.weeks,
      p_return_event: q.value.return_event ?? null,
    });
    if (error) return rpcError(c, error);
    return c.json({ ok: true, data });
  });
}
