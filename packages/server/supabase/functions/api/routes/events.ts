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
 *         batch <= 50 events / 64 KB; RLS read-only for org members.
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
import {
  EVENT_NAME_RE,
  EVENT_PROPERTY_LIMITS,
  MUSHI_SURFACES,
  PII_PROPERTY_KEY_RE,
  RESERVED_PROPERTY_PREFIX,
} from '../../_shared/analytics-taxonomy.generated.ts';

// ─── Schema ──────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024;

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
  '$first_touch', '$ref',
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

    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) {
      return c.json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Event batch exceeds 64 KB' } }, 413);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
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
    const db = getServiceClient();
    const meta = await loadProjectMeta(db, projectId);
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
          reporterTokenHash: batch.anon_id ?? null,
        });
        endUserId = resolved?.id ?? null;
      } catch (err) {
        log.warn('events: resolveEndUser failed', { err: err instanceof Error ? err.message : String(err) });
      }
    }

    const receivedAt = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    let dropped = 0;
    let identifyRequested = false;

    for (const ev of batch.events) {
      if (ev.name === 'identify') {
        identifyRequested = true;
        continue; // pseudo-event: stitching only, never stored
      }
      const { properties } = sanitizeProperties(ev.properties);
      if (JSON.stringify(properties).length > EVENT_PROPERTY_LIMITS.maxBytes) { dropped += 1; continue; }
      const surface = batch.surface ?? (typeof properties.$surface === 'string' ? properties.$surface : 'web');
      rows.push({
        project_id: projectId,
        event_name: ev.name,
        ts: ev.ts ?? receivedAt,
        received_at: receivedAt,
        session_id: batch.session_id ?? null,
        anon_id: batch.anon_id ?? null,
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
    if ((identifyRequested || endUserId) && endUserId && batch.anon_id) {
      const { error: bfErr } = await db
        .from('product_events')
        .update({ end_user_id: endUserId })
        .eq('project_id', projectId)
        .eq('anon_id', batch.anon_id)
        .is('end_user_id', null);
      if (bfErr) log.warn('events: identify backfill failed', { err: bfErr.message, projectId });
    }

    return c.json({ ok: true, data: { accepted, dropped } });
  });
}
