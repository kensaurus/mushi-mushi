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
 * Older SDKs send their reporter token as anon_id — a bearer credential for
 * the end user's report threads — so anon_id is stored only as the one-way
 * reporter key, the same key the report path stores
 * (_shared/reporter-token.ts).
 *
 * Identity stitching: an `identify` pseudo-event (never stored) plus
 * `user_id` (+ traits) resolves an end_users row (org-scoped) and backfills
 * end_user_id onto earlier anonymous rows with the same anon_id. Traits other
 * than email/name (e.g. identify(id, { plan: 'pro' })) are merged into
 * end_users.traits for the People filter; until 2026-09-21 they were dropped.
 *
 * Automation: a batch whose User-Agent names a headless browser, test driver
 * or crawler (_shared/automated-agent.ts) is accepted-but-dropped with
 * reason 'automated_agent', so test runs and crawlers never count as people.
 */

import type { Hono } from 'npm:hono@4';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';
import type { Variables } from '../types.ts';
import { apiKeyAuth } from '../../_shared/auth.ts';
import { getServiceClient } from '../../_shared/db.ts';
import { log } from '../../_shared/logger.ts';
import { resolveEndUser } from '../../_shared/end-user-resolver.ts';
import { reporterKeyOrNull } from '../../_shared/reporter-token.ts';
import { isAutomatedUserAgent } from '../../_shared/automated-agent.ts';
import {
  EVENT_NAME_RE,
  EVENT_PROPERTY_LIMITS,
  MUSHI_EVENTS,
  MUSHI_SURFACES,
  PII_PROPERTY_KEY_RE,
  RESERVED_PROPERTY_PREFIX,
} from '../../_shared/analytics-taxonomy.generated.ts';
import { claimIngestBudget, clientIp } from './ingest-budget.ts';

// ─── Schema ──────────────────────────────────────────────────────────────────

const MAX_BODY_BYTES = 64 * 1024;

/** One claim per batch; the SDK sends at most one batch per 5 s per tab. */
const EVENT_BATCHES_PER_MINUTE = 600;

/**
 * Per client IP, across projects: one public key must not let a single host
 * spend a whole project's budget. 300 batches a minute is ~25 busy tabs
 * behind one NAT at the SDK's 5 s flush.
 */
const EVENT_BATCHES_PER_IP_PER_MINUTE = 300;

/** How long a project's distinct event-name set is trusted before re-reading. */
const EVENT_NAMES_TTL_MS = 5 * 60_000;

/** The SDK spill replays at most 24 h, so anything older or in the future is clock skew or forgery. */
export const CLIENT_TS_MAX_PAST_MS = 25 * 60 * 60 * 1000;
export const CLIENT_TS_MAX_FUTURE_MS = 5 * 60 * 1000;

/** Events only emitProductEvent may write (taxonomy surface 'server'). */
export const SERVER_OWNED_EVENTS: ReadonlySet<string> = new Set(
  Object.entries(MUSHI_EVENTS)
    .filter(([, spec]) => [(spec as { surface: string | readonly string[] }).surface].flat().every((s) => s === 'server'))
    .map(([name]) => name),
);

/**
 * Surfaces a public SDK key may claim. 'server' and 'mcp' are written only by
 * emitProductEvent (MCP usage is recorded by the api and the hosted MCP
 * server, never reported by a browser).
 */
export const PUBLIC_SURFACES: ReadonlySet<string> = new Set(
  MUSHI_SURFACES.filter((s) => s !== 'server' && s !== 'mcp'),
);

/** Distinct event names already stored per project (bounded by the cap + 1). */
const projectEventNames = new Map<string, { names: Set<string>; at: number }>();

async function loadProjectEventNames(
  db: ReturnType<typeof getServiceClient>,
  projectId: string,
): Promise<Set<string>> {
  const cached = projectEventNames.get(projectId);
  if (cached && Date.now() - cached.at < EVENT_NAMES_TTL_MS) return cached.names;
  const { data, error } = await db.rpc('product_event_names', {
    p_project_id: projectId,
    p_limit: EVENT_PROPERTY_LIMITS.maxEventNamesPerProject + 1,
  });
  // Fail open on a read error: the cap guards cardinality, not security, and
  // a stale cache must not turn into dropped events.
  const names = new Set<string>(error ? [] : ((data as string[] | null) ?? []));
  if (error) log.warn('events: event-name lookup failed', { err: error.message, projectId });
  projectEventNames.set(projectId, { names, at: Date.now() });
  return names;
}

/**
 * Split events into those the per-project name cap admits and those it drops.
 * Known names always pass; a new name passes while the project is under the
 * cap. Mutates `known` with admitted new names. Exported for tests.
 */
export function admitEventNames<T extends { name: string }>(
  events: readonly T[],
  known: Set<string>,
  cap: number,
): { admitted: T[]; overCap: number } {
  const admitted: T[] = [];
  let overCap = 0;
  for (const ev of events) {
    if (known.has(ev.name) || known.size < cap) {
      known.add(ev.name);
      admitted.push(ev);
    } else {
      overCap += 1;
    }
  }
  return { admitted, overCap };
}

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
  // The SDK never sends more than maxKeys; a larger record is a hand-rolled
  // client, refused before any per-key work.
  properties: z
    .record(propertyValue)
    .refine((o) => Object.keys(o).length <= EVENT_PROPERTY_LIMITS.maxKeys, {
      message: `at most ${EVENT_PROPERTY_LIMITS.maxKeys} properties per event`,
    })
    .optional(),
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

/** identify() traits stored in their own end_users columns, not in `traits`. */
const TRAITS_STORED_ELSEWHERE: ReadonlySet<string> = new Set(['email', 'name']);

/** end_users.traits has a CHECK (pg_column_size(traits) <= 2048). */
export const MAX_PERSON_TRAITS_BYTES = 1024;

/**
 * Person properties from identify(id, traits) for end_users.traits (the People
 * tab filter). email and name are stored elsewhere (email only as a hash), so
 * they never land here; everything else passes the same contract as event
 * properties (scalars only, no `$` or PII-looking keys, length caps) and a
 * byte budget, dropping keys past it in input order. Exported for tests.
 */
export function extractPersonTraits(
  input: Record<string, unknown> | null | undefined,
): Record<string, PropertyValue> {
  const scalars: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (TRAITS_STORED_ELSEWHERE.has(key)) continue;
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      scalars[key] = value;
    }
  }
  const { properties } = sanitizeProperties(scalars);
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    const next = { ...out, [key]: value };
    if (JSON.stringify(next).length > MAX_PERSON_TRAITS_BYTES) break;
    out[key] = value;
  }
  return out;
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

    // SDK keys carry report:write; an agent-only key has no business writing
    // a project's analytics.
    const scopes = (c.get('apiKeyScopes') as string[] | undefined) ?? [];
    if (!scopes.includes('report:write')) {
      return c.json(
        { ok: false, error: { code: 'INSUFFICIENT_SCOPE', message: 'Event ingest needs an SDK key (report:write).' } },
        403,
      );
    }

    const tooLarge = () =>
      c.json({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Event batch exceeds 64 KB' } }, 413);
    const contentLength = Number(c.req.header('content-length') ?? '0');
    if (contentLength > MAX_BODY_BYTES) return tooLarge();

    const db = getServiceClient();
    const budget = await claimIngestBudget(
      db,
      projectId,
      clientIp((name) => c.req.header(name)),
      { scope: 'product_events', perProjectPerMinute: EVENT_BATCHES_PER_MINUTE, perIpPerMinute: EVENT_BATCHES_PER_IP_PER_MINUTE },
      (scope, err) => log.error('events: rate-limit claim failed — failing closed', { err, scope }),
    );
    if (budget === 'limited') {
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
    if (isAutomatedUserAgent(c.req.header('user-agent'))) {
      // Accepted-but-dropped: a test runner must not retry, and must not count.
      return c.json({ ok: true, data: { accepted: 0, dropped: batch.events.length, reason: 'automated_agent' } });
    }
    const meta = await loadProjectMeta(db, projectId);
    const anonKey = await reporterKeyOrNull(batch.anon_id);
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

    // Person traits: merged (jsonb ||) by merge_end_user_traits, which skips
    // the write when the row already holds them and refuses a merge that
    // would break the 2 KB column cap. Non-fatal: events still land.
    const personTraits = extractPersonTraits(batch.user_traits);
    if (endUserId && Object.keys(personTraits).length > 0) {
      const { error: traitErr } = await db.rpc('merge_end_user_traits', {
        p_end_user_id: endUserId,
        p_traits: personTraits,
      });
      if (traitErr) log.warn('events: trait merge failed', { err: traitErr.message, projectId });
    }

    const receivedAtMs = Date.now();
    const receivedAt = new Date(receivedAtMs).toISOString();
    const rows: Record<string, unknown>[] = [];
    let dropped = 0;
    let identifyRequested = false;

    // Cardinality cap: past maxEventNamesPerProject distinct names, new names
    // are dropped (known names keep flowing), so a runaway `track(\`${id}\`)`
    // cannot explode the funnel builder's name list.
    const known = await loadProjectEventNames(db, projectId);
    const storable = batch.events.filter((ev) => ev.name !== 'identify');
    const { admitted, overCap } = admitEventNames(storable, known, EVENT_PROPERTY_LIMITS.maxEventNamesPerProject);
    dropped += overCap;
    if (overCap > 0) log.warn('events: event-name cap reached', { projectId, overCap });
    identifyRequested = storable.length !== batch.events.length;

    for (const ev of admitted) {
      // ('identify' is a pseudo-event: stitching only, never stored — filtered above.)
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
