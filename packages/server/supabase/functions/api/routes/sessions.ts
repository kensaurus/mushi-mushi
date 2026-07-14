/**
 * FILE: packages/server/supabase/functions/api/routes/sessions.ts
 * PURPOSE: POST /v1/sdk/session — ingest lightweight SDK session-lifecycle
 *          events (session_start, heartbeat, page_view, session_end).
 *
 * Auth:   Public SDK API key (same as /v1/sdk/discovery). Sets `projectId`.
 * Safety: Strict Zod validation, per-(project, session_id) upsert/update writes.
 *         No PII stored beyond the opaque reporter_token_hash already used in
 *         reports. Rate-limit: one upsert per event — cheap O(1) writes.
 */

import type { Hono } from 'npm:hono@4';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';

// ─── Schema ──────────────────────────────────────────────────────────────────

const sessionEventSchema = z.object({
  kind: z.enum(['session_start', 'session_heartbeat', 'session_end', 'page_view']),
  session_id: z.string().min(1).max(128),
  ts: z.string().datetime({ offset: true }).optional(),
  route: z.string().max(1024).optional().nullable(),
  referrer: z.string().max(1024).optional().nullable(),
  page_view_count: z.number().int().min(0).max(100_000).optional(),
  reporter_token_hash: z.string().max(128).optional().nullable(),
  user_id_hash: z.string().max(256).optional().nullable(),
  user_agent: z.string().max(512).optional().nullable(),
  sdk_version: z.string().max(32).optional(),
});

type SessionEvent = z.infer<typeof sessionEventSchema>;

// ─── Route registration ───────────────────────────────────────────────────────

export function registerSessionRoutes(app: Hono<{ Variables: Variables }>): void {
  // POST /v1/sdk/session
  // Upserts an end_user_sessions row and (for page_view events) inserts a
  // session_page_views row. Fire-and-forget on the client side — always
  // returns { accepted: true } for valid payloads so the client doesn't retry.
  // CORS is handled by the /v1/sdk/* middleware registered in index.ts.
  app.post('/v1/sdk/session', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON body required' } }, 400);
    }

    const parsed = sessionEventSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_SESSION_EVENT',
            message: parsed.error.issues[0]?.message ?? 'session event failed validation',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
        422,
      );
    }

    const event: SessionEvent = parsed.data;
    const db = getServiceClient();
    const ts = event.ts ?? new Date().toISOString();

    // Sanitise route: strip query strings and fragments to avoid storing PII
    // in URL parameters (mirrors the discovery_events route sanitisation).
    const sanitisedRoute = sanitiseRoute(event.route);

    if (event.kind === 'session_start') {
      const { error } = await db.from('end_user_sessions').upsert(
        {
          project_id: projectId,
          session_id: event.session_id,
          reporter_token_hash: event.reporter_token_hash ?? null,
          user_agent: event.user_agent ?? null,
          entry_route: sanitisedRoute,
          page_view_count: event.page_view_count ?? 1,
          started_at: ts,
          last_seen_at: ts,
        },
        { onConflict: 'project_id,session_id', ignoreDuplicates: true },
      );
      if (error) log.warn('session_start upsert failed', { err: error.message, projectId });
    } else if (event.kind === 'session_heartbeat') {
      const { error } = await db
        .from('end_user_sessions')
        .update({ last_seen_at: ts, page_view_count: event.page_view_count ?? 1 })
        .eq('project_id', projectId)
        .eq('session_id', event.session_id);
      if (error) log.warn('session_heartbeat update failed', { err: error.message, projectId });
    } else if (event.kind === 'session_end') {
      const { error } = await db
        .from('end_user_sessions')
        .update({
          last_seen_at: ts,
          ended_at: ts,
          page_view_count: event.page_view_count ?? 1,
        })
        .eq('project_id', projectId)
        .eq('session_id', event.session_id);
      if (error) log.warn('session_end update failed', { err: error.message, projectId });
    } else if (event.kind === 'page_view') {
      const [updateRes, insertRes] = await Promise.all([
        db
          .from('end_user_sessions')
          .update({ last_seen_at: ts, page_view_count: event.page_view_count ?? 1 })
          .eq('project_id', projectId)
          .eq('session_id', event.session_id),
        sanitisedRoute
          ? db.from('session_page_views').insert({
              project_id: projectId,
              session_id: event.session_id,
              route: sanitisedRoute,
              ts,
            })
          : Promise.resolve({ error: null }),
      ]);
      if (updateRes.error) log.warn('page_view session update failed', { err: updateRes.error.message });
      const pgvErr = (insertRes as { error?: { message: string } | null }).error;
      if (pgvErr) log.warn('page_view insert failed', { err: pgvErr.message });
    }

    return c.json({ ok: true, data: { accepted: true } });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip query string and fragment from a route to avoid storing URL-embedded PII. */
function sanitiseRoute(route: string | null | undefined): string | null {
  if (!route) return null;
  try {
    const u = new URL(route);
    return u.pathname;
  } catch {
    // Already a path — strip from ? or # onward.
    return route.split('?')[0].split('#')[0] || null;
  }
}
