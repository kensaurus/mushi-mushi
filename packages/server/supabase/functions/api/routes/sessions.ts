/**
 * FILE: packages/server/supabase/functions/api/routes/sessions.ts
 * PURPOSE: POST /v1/sdk/session — ingest lightweight SDK session-lifecycle
 *          events (session_start, heartbeat, page_view, session_end).
 *
 * Auth:   Public SDK API key (same as /v1/sdk/discovery). Sets `projectId`.
 * Safety: Strict Zod validation, per-(project, session_id) upsert/update writes.
 *         The SDK sends its raw reporter token (a bearer credential for the
 *         end user's report threads) in `reporter_token_hash`; only the
 *         one-way reporter key is stored — the same key the report path
 *         stores — via _shared/reporter-token.ts. Until 2026-09-21 the raw
 *         token was stored verbatim. Rate-limit: per project and per client IP
 *         (ingest-budget.ts); one upsert per event.
 *
 * Automation: a session whose User-Agent names a headless browser, test
 * driver or crawler (_shared/automated-agent.ts) is stored with is_bot = true
 * and its page views are not recorded, so the activity RPCs can leave it out
 * of every count. Until 2026-09-21 a local Playwright run against a
 * production key made up 203 of one project's 212 weekly sessions.
 *
 * Identity: when the SDK forwards a signed X-Mushi-User-Token, session_start
 * and page_view verify it (_shared/end-user-identity.ts) and store
 * end_user_id, which the activity RPCs count as identified. Heartbeats and
 * session_end skip it: verifying reads Vault, and a heartbeat arrives every
 * minute per tab. An unverified or failed token never blocks the write.
 */

import type { Hono } from 'npm:hono@4';
import { z } from 'npm:zod@3';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { reporterKeyOrNull } from '../../_shared/reporter-token.ts';
import { isAutomatedUserAgent } from '../../_shared/automated-agent.ts';
import { MUSHI_USER_TOKEN_HEADER, verifyEndUserToken } from '../../_shared/end-user-identity.ts';
import { claimIngestBudget, clientIp } from './ingest-budget.ts';

/**
 * One request per session event: a tab sends session_start, a heartbeat a
 * minute and one page_view per navigation. The per-IP budget stops one host
 * spending the project's (the key is public).
 */
const SESSION_EVENTS_PER_MINUTE = 3000;
const SESSION_EVENTS_PER_IP_PER_MINUTE = 600;

// ─── Schema ──────────────────────────────────────────────────────────────────

const SHA256_HEX = /^[0-9a-f]{64}$/;

const sessionEventSchema = z.object({
  kind: z.enum(['session_start', 'session_heartbeat', 'session_end', 'page_view']),
  session_id: z.string().min(1).max(128),
  ts: z.string().datetime({ offset: true }).optional(),
  route: z.string().max(1024).optional().nullable(),
  referrer: z.string().max(1024).optional().nullable(),
  page_view_count: z.number().int().min(0).max(100_000).optional(),
  reporter_token_hash: z.string().max(128).optional().nullable(),
  // Not stored. The web SDK sends the identity token's raw `sub` here, so
  // anything that is not a SHA-256 hex digest becomes null instead of a 422
  // (which would drop the whole event) and can never be persisted by mistake.
  user_id_hash: z
    .string()
    .max(256)
    .optional()
    .nullable()
    .transform((v) => (v && SHA256_HEX.test(v) ? v : null)),
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

    const budget = await claimIngestBudget(
      getServiceClient(),
      projectId,
      clientIp((name) => c.req.header(name)),
      { scope: 'sdk_sessions', perProjectPerMinute: SESSION_EVENTS_PER_MINUTE, perIpPerMinute: SESSION_EVENTS_PER_IP_PER_MINUTE },
      (scope, err) => log.error('sessions: rate-limit claim failed — failing closed', { err, scope }),
    );
    if (budget === 'limited') {
      c.header('Retry-After', '60');
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Session ingest rate limit exceeded. Retry in 60 seconds.' } }, 429);
    }

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
    // The SDK copies navigator.userAgent into every event; fall back to the
    // request header for clients that omit it.
    const automated = isAutomatedUserAgent(event.user_agent ?? c.req.header('user-agent'));

    // Sanitise route: strip query strings and fragments to avoid storing PII
    // in URL parameters (mirrors the discovery_events route sanitisation).
    const sanitisedRoute = sanitiseRoute(event.route);

    // page_view_count is optional: a client that omits it must not reset the
    // stored count. Only the session_start insert defaults it to 1.
    const pageViews = event.page_view_count !== undefined ? { page_view_count: event.page_view_count } : {};

    let endUserId: string | null = null;
    const userToken = c.req.header(MUSHI_USER_TOKEN_HEADER);
    if (userToken && (event.kind === 'session_start' || event.kind === 'page_view')) {
      const verified = await verifyEndUserToken(db, projectId, userToken).catch((err: unknown) => {
        log.warn('sessions: verifyEndUserToken threw (fail-open)', { projectId, err: String(err) });
        return null;
      });
      endUserId = verified?.endUserId ?? null;
    }
    const identity = endUserId ? { end_user_id: endUserId } : {};

    if (event.kind === 'session_start') {
      const { error } = await db.from('end_user_sessions').upsert(
        {
          project_id: projectId,
          session_id: event.session_id,
          reporter_token_hash: await reporterKeyOrNull(event.reporter_token_hash),
          user_agent: event.user_agent ?? null,
          entry_route: sanitisedRoute,
          page_view_count: event.page_view_count ?? 1,
          started_at: ts,
          last_seen_at: ts,
          ...identity,
          // Only sent when true: the column defaults to false, so human
          // sessions keep writing even before migration 20260921000010 lands.
          ...(automated ? { is_bot: true } : {}),
        },
        { onConflict: 'project_id,session_id', ignoreDuplicates: true },
      );
      if (error) log.warn('session_start upsert failed', { err: error.message, projectId });
    } else if (event.kind === 'session_heartbeat') {
      const { error } = await db
        .from('end_user_sessions')
        .update({ last_seen_at: ts, ...pageViews })
        .eq('project_id', projectId)
        .eq('session_id', event.session_id);
      if (error) log.warn('session_heartbeat update failed', { err: error.message, projectId });
    } else if (event.kind === 'session_end') {
      const { error } = await db
        .from('end_user_sessions')
        .update({
          last_seen_at: ts,
          ended_at: ts,
          ...pageViews,
        })
        .eq('project_id', projectId)
        .eq('session_id', event.session_id);
      if (error) log.warn('session_end update failed', { err: error.message, projectId });
    } else if (event.kind === 'page_view') {
      const [updateRes, insertRes] = await Promise.all([
        db
          .from('end_user_sessions')
          .update({ last_seen_at: ts, ...pageViews, ...identity })
          .eq('project_id', projectId)
          .eq('session_id', event.session_id),
        sanitisedRoute && !automated
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

    return c.json({ ok: true, data: { accepted: true, ...(automated ? { automated: true } : {}) } });
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
