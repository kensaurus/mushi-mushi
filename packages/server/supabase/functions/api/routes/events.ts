/**
 * FILE: packages/server/supabase/functions/api/routes/events.ts
 * PURPOSE: POST /v1/sdk/events — batch ingest for Mushi.track() product
 *          analytics events ("Users & Funnels"). Also the sink for Mushi's
 *          own dogfooded funnel (landing, docs, console) under the self project.
 *
 * Auth:   Project-scoped SDK API key (apiKeyAuth) — same as /v1/sdk/session.
 * Safety: Strict Zod validation; event-name regex + property caps mirrored
 *         from packages/core/src/analytics-taxonomy.ts via the generated
 *         Deno file; PII-looking property keys dropped server-side too;
 *         per-project switch project_settings.product_events_enabled;
 *         batch <= 50 events / 64 KB (counted on the streamed body, not the
 *         Content-Length header); per-project rate limit; client timestamps
 *         clamped to [received - 25 h, received + 5 min]; server-owned event
 *         names and the 'server' surface are rejected here (only
 *         emitProductEvent writes those); RLS read-only for org members.
 *
 * The SDK's anon_id is its reporter token — a bearer credential for the
 * end user's report threads — so it is stored only as sha256(value), the same
 * digest the report path stores (_shared/reporter-token.ts).
 *
 * Identity stitching: an `identify` pseudo-event (never stored) plus
 * `user_id` (+ traits) resolves an end_users row (org-scoped) and backfills
 * end_user_id onto earlier anonymous rows with the same anon_id.
 */

import type { Hono } from 'npm:hono@4';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { resolveEndUser } from '../../_shared/end-user-resolver.ts';
import { hashReporterTokenOrNull } from '../../_shared/reporter-token.ts';
import {
  EVENT_NAME_RE,
  EVENT_PROPERTY_LIMITS,
  MUSHI_EVENTS,
  MUSHI_SURFACES,
  PII_PROPERTY_KEY_RE,
  RESERVED_PROPERTY_PREFIX,
} from '../../_shared/analytics-taxonomy.generated.ts';
import { classifyIngestRateLimitError } from './ingest-rate-limit.ts';

// ─── Schema ──────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024;

/** One claim per batch; the SDK sends at most one batch per 5 s per tab. */
const EVENT_BATCHES_PER_MINUTE = 600;

/** The SDK spill replays at most 24 h, so anything older or in the future is clock skew or forgery. */
export const CLIENT_TS_MAX_PAST_MS = 25 * 60 * 60 * 1000;
export const CLIENT_TS_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Events only emitProductEvent may write (taxonomy surface 'server'). */
export const SERVER_OWNED_EVENTS: ReadonlySet<string> = new Set(
  Object.entries(MUSHI_EVENTS)
    .filter(([, spec]) => (spec as { surface?: string }).surface === 'server')
    .map(([name]) => name),
);

/** Surfaces a public SDK key may claim. 'server' is written only by emitProductEvent. */
export const PUBLIC_SURFACES: ReadonlySet<string> = new Set(MUSHI_SURFACES.filter((s) => s !== 'server'));

/**
 * Read at most `limit` bytes of a request body. Returns null when the body is
 * larger. Content-Length alone is not a cap: a chunked request omits it.
 * Exported for tests.
 */
export async function readBodyCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Keep a client timestamp only when it is plausible; otherwise use the receive
 * time. A future-dated row would never be pruned by retention and a backdated
 * one would move funnel steps into closed weeks. Exported for tests.
 */
export function clampEventTs(clientTs: string | undefined, receivedAtMs: number): { ts: string; clamped: boolean } {
  const receivedIso = new Date(receivedAtMs).toISOString();
  if (!clientTs) return { ts: receivedIso, clamped: false };
  const t = Date.parse(clientTs);
  if (!Number.isFinite(t)) return { ts: receivedIso, clamped: true };
  if (t < receivedAtMs - CLIENT_TS_MAX_PAST_MS || t > receivedAtMs + CLIENT_TS_MAX_FUTURE_MS) {
    return { ts: receivedIso, clamped: true };
  }
  return { ts: new Date(t).toISOString(), clamped: false };
}

type PropertyValue = string | number | boolean | null;

const propertyValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const eventSchema = z.object({
  name: z.string().regex(EVENT_NAME_RE, 'event name must match ^[a-z][a-z0-9_]{1,63}$'),
  ts: z.string().datetime({ offset: true }).optional(),
  properties: z.record(propertyValue).optional(),
  dedup_key: z.string().min(1).max(128).optional(),
});

export const batchSchema = z.object({
  anon_id: z.string().max(128).optional().nullable(),
  user_id: z.string().max(256).optional().nullable(),
  user_traits: z
    .object({
      email: z.string().max(320).optional().nullable(),
      name: z.string().max(120).optional().nullable(),
    })
    .passthrough()
    .optional()
    .nullable(),
  session_id: z.string().max(128).optional().nullable(),
  sdk_version: z.string().max(32).optional().nullable(),
  surface: z.enum(MUSHI_SURFACES).optional(),
  events: z.array(eventSchema).min(1).max(EVENT_PROPERTY_LIMITS.maxServerBatch),
});

type EventBatch = z.infer<typeof batchSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SDK-owned keys that may travel on the wire; every other `$key` is dropped. */
const SDK_RESERVED_ALLOW = new Set([
  '$surface', '$route', '$referrer', '$session_id', '$sdk_version',
  '$utm_source', '$utm_medium', '$utm_campaign', '$utm_content', '$utm_term',
  '$first_touch', '$ref', '$client_ts',
]);

/** Server-side re-application of the property contract (defence in depth). Exported for tests. */
export function sanitizeProperties(
  input: Record<string, PropertyValue> | undefined,
): { properties: Record<string, PropertyValue>; dropped: number } {
  const out: Record<string, PropertyValue> = {};
  let dropped = 0;
  let keys = 0;
  for (const [rawKey, value] of Object.entries(input ?? {})) {
    if (keys >= EVENT_PROPERTY_LIMITS.maxKeys) { dropped += 1; continue; }
    const key = rawKey.slice(0, EVENT_PROPERTY_LIMITS.maxKeyLength);
    if (key.startsWith(RESERVED_PROPERTY_PREFIX) && !SDK_RESERVED_ALLOW.has(key)) { dropped += 1; continue; }
    if (PII_PROPERTY_KEY_RE.test(key)) { dropped += 1; continue; }
    if (typeof value === 'string') {
      out[key] = value.slice(0, EVENT_PROPERTY_LIMITS.maxValueLength);
    } else if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : null;
    } else {
      out[key] = value;
    }
    keys += 1;
  }
  return { properties: out, dropped };
}

/** Cached per-project switch + org id (cheap; evicted per isolate lifetime). */
const projectMeta = new Map<string, { enabled: boolean; orgId: string | null; at: number }>();
const META_TTL_MS = 60_000;

async function loadProjectMeta(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<{ enabled: boolean; orgId: string | null }> {
  const cached = projectMeta.get(projectId);
  if (cached && Date.now() - cached.at < META_TTL_MS) return cached;
  const [settingsRes, projectRes] = await Promise.all([
    db.from('project_settings').select('product_events_enabled').eq('project_id', projectId).maybeSingle(),
    db.from('projects').select('organization_id').eq('id', projectId).maybeSingle(),
  ]);
  const enabled = (settingsRes.data?.product_events_enabled as boolean | undefined) ?? true;
  const orgId = (projectRes.data?.organization_id as string | undefined) ?? null;
  const meta = { enabled, orgId, at: Date.now() };
  projectMeta.set(projectId, meta);
  return meta;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerEventRoutes(app: Hono<{ Variables: Variables }>): void {
  // POST /v1/sdk/events
  // CORS is handled by the /v1/sdk/* middleware registered in index.ts.
  app.post('/v1/sdk/events', apiKeyAuth, async (c) => {
    const projectId = c.get('projectId') as string;

    const tooLarge = () =>
      c.json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Event batch exceeds 64 KB' } }, 413);
    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) return tooLarge();

    const db = getServiceClient();
    const { error: rateErr } = await db.rpc('scoped_rate_limit_claim', {
      p_user_id: projectId,
      p_scope: 'product_events',
      p_max_per_window: EVENT_BATCHES_PER_MINUTE,
      p_window: '1 minute',
    });
    const rateOutcome = classifyIngestRateLimitError(rateErr);
    if (rateOutcome === 'breach' || rateOutcome === 'fail-closed') {
      if (rateOutcome === 'fail-closed') log.error('events: rate-limit claim failed — failing closed', { err: rateErr?.message });
      c.header('Retry-After', '60');
      return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: 'Event ingest rate limit exceeded. Retry in 60 seconds.' } }, 429);
    }

    const bodyText = await readBodyCapped(c.req.raw, MAX_BODY_BYTES);
    if (bodyText === null) return tooLarge();
    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      return c.json({ ok: false, error: { code: 'INVALID_JSON', message: 'JSON body required' } }, 400);
    }

    const parsed = batchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        {
          ok: false,
          error: {
            code: 'INVALID_EVENT_BATCH',
            message: parsed.error.issues[0]?.message ?? 'event batch failed validation',
            issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          },
        },
        422,
      );
    }

    const batch: EventBatch = parsed.data;
    const meta = await loadProjectMeta(db, projectId);
    const anonKey = await hashReporterTokenOrNull(batch.anon_id);
    if (!meta.enabled) {
      // Accepted-but-dropped keeps well-behaved clients from retrying.
      return c.json({ ok: true, data: { accepted: 0, dropped: batch.events.length, reason: 'disabled' } });
    }

    // Identity: resolve an end_users row when the host identified the user.
    let endUserId: string | null = null;
    if (batch.user_id && meta.orgId) {
      try {
        const resolved = await resolveEndUser(db, {
          organizationId: meta.orgId,
          externalUserId: batch.user_id,
          traits: batch.user_traits
            ? { email: batch.user_traits.email ?? null, name: batch.user_traits.name ?? null }
            : undefined,
          reporterTokenHash: anonKey,
        });
        endUserId = resolved?.id ?? null;
      } catch (err) {
        log.warn('events: resolveEndUser failed', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    const receivedAtMs = Date.now();
    const receivedAt = new Date(receivedAtMs).toISOString();
    const rows: Record<string, unknown>[] = [];
    let dropped = 0;
    let identifyRequested = false;

    for (const ev of batch.events) {
      if (ev.name === 'identify') {
        identifyRequested = true;
        continue; // pseudo-event: stitching only, never stored
      }
      // Server milestones (first_report_received, project_created, …) are
      // written only by emitProductEvent; a public key must not forge them.
      if (SERVER_OWNED_EVENTS.has(ev.name)) { dropped += 1; continue; }
      const { properties } = sanitizeProperties(ev.properties);
      if (JSON.stringify(properties).length > EVENT_PROPERTY_LIMITS.maxBytes) { dropped += 1; continue; }
      const surface = batch.surface ?? (typeof properties.$surface === 'string' ? properties.$surface : 'web');
      // Unknown surfaces would violate the DB CHECK and 500 the whole batch.
      if (!PUBLIC_SURFACES.has(surface)) { dropped += 1; continue; }
      const { ts, clamped } = clampEventTs(ev.ts, receivedAtMs);
      if (clamped && ev.ts) properties.$client_ts = ev.ts.slice(0, EVENT_PROPERTY_LIMITS.maxValueLength);
      rows.push({
        project_id: projectId,
        event_name: ev.name,
        ts,
        received_at: receivedAt,
        session_id: batch.session_id ?? null,
        anon_id: anonKey,
        end_user_id: endUserId,
        surface,
        sdk_version: batch.sdk_version ?? null,
        dedup_key: ev.dedup_key ?? null,
        properties: { ...properties, $surface: surface },
      });
    }

    let accepted = 0;
    if (rows.length > 0) {
      // Dedup keys are optional; duplicates on (project_id, dedup_key) are
      // idempotent replays, so ignore them instead of failing the batch.
      const { error, count } = await db
        .from('product_events')
        .upsert(rows, { onConflict: 'project_id,dedup_key', ignoreDuplicates: true, count: 'exact' });
      if (error) {
        log.warn('events: insert failed', { err: error.message, projectId, rows: rows.length });
        return c.json({ ok: false, error: { code: 'INSERT_FAILED', message: 'could not store events' } }, 500);
      }
      accepted = count ?? rows.length;
    }

    // Cross-surface stitching: attach the person to earlier anonymous rows.
    if ((identifyRequested || endUserId) && endUserId && anonKey) {
      const { error: bfErr } = await db
        .from('product_events')
        .update({ end_user_id: endUserId })
        .eq('project_id', projectId)
        .eq('anon_id', anonKey)
        .is('end_user_id', null);
      if (bfErr) log.warn('events: identify backfill failed', { err: bfErr.message, projectId });
    }

    return c.json({ ok: true, data: { accepted, dropped } });
  });
}
