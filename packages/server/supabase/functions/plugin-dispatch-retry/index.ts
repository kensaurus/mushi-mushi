// ============================================================
// plugin-dispatch-retry — every minute (pg_cron)
//
// Claims `plugin_dispatch_log` rows with status='pending' whose
// `next_retry_at` has elapsed and replays them against the original
// plugin webhook through the SAME signing path as the first dispatch
// (`postSignedWebhook` in _shared/plugins.ts). Schedule (exponential
// backoff ±20% jitter): 30s, 2m, 10m, 1h, 6h — after attempt=5 the row
// is marked permanently 'error' and the installed plugin's
// last_delivery_status becomes 'error'.
//
// Claiming (2026-08-16 audit C1): rows are leased by
// `claim_plugin_dispatch_retries()` (FOR UPDATE SKIP LOCKED) before any
// POST goes out. A full tick can take 50 rows / 5 concurrency × 8s = 80s,
// which overruns the 60s cadence — without the lease, tick N+1 read the
// rows tick N was still delivering and double-sent every one of them.
// A worker that dies mid-tick leaves its lease behind; the claim function
// reclaims those rows after 5 minutes.
//
// Fidelity (2026-08-16 audit C2): the retry replays the EXACT bytes
// stored in `plugin_dispatch_log.payload` — the original envelope, whose
// sha256 is `payload_digest` — under the ORIGINAL webhook-id (so the
// receiver's Standard Webhooks dedupe recognises it) with a FRESH
// timestamp and signature (receivers reject timestamps outside ±5 min).
// The old code fabricated a `{ retryOf, attempt }` envelope instead,
// which matched neither the digest nor the receiver's signature check.
// Rows logged before migration 20260816120000 have no stored payload and
// are finalised as 'unrecoverable' rather than sent as a synthetic body.
//
// Limits per run: BATCH_SIZE rows at concurrency CONCURRENCY. Note this
// does NOT fit inside one 60s tick in the worst case (see the 80s figure
// above) — the lease is what makes the overrun safe: a tick that runs long
// simply holds its rows, and the next tick claims a disjoint set rather
// than re-sending them.
// ============================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { getServiceClient } from '../_shared/db.ts';
import { log } from '../_shared/logger.ts';
import { withSentry } from '../_shared/sentry.ts';
import { safeErrorResponse } from '../_shared/safe-error.ts';
import { requireServiceRoleAuth } from '../_shared/auth.ts';
import { startCronRun } from '../_shared/telemetry.ts';
import { notifyOperator } from '../_shared/operator-notify.ts';
import { postSignedWebhook } from '../_shared/plugins.ts';

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(name: string): string | undefined };
};

const plog = log.child('plugin-dispatch-retry');

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const CONCURRENCY = 5;
const DISPATCH_TIMEOUT_MS = 8_000;
const RESPONSE_EXCERPT_MAX = 512;
const MAX_ATTEMPTS = 5;

/** Backoff minutes-from-original-attempt for attempts 1..5. Index 0 maps to
 *  the very first retry (after a failed initial dispatch). After attempt 5
 *  the row is finalised as 'error'. */
const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];

/** Fraction of the backoff to spread each retry over, ± (2026-08-16 audit H5).
 *  One receiver outage fails many deliveries within the same second; a fixed
 *  schedule then re-fires all of them at the same instant, so the receiver is
 *  hit by the full herd the moment it comes back and fails them again in
 *  lockstep. ±20% decorrelates the wave without meaningfully changing the
 *  advertised 30s/2m/10m/1h/6h cadence. */
const JITTER_RATIO = 0.2;

function withJitter(ms: number): number {
  const spread = ms * JITTER_RATIO;
  return Math.round(ms - spread + Math.random() * spread * 2);
}

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

interface ClaimedRow {
  id: number;
  delivery_id: string;
  project_id: string;
  plugin_slug: string;
  event: string;
  attempt: number;
  /** Exact bytes signed on the first dispatch. NULL on rows logged before
   *  migration 20260816120000 — those cannot be replayed faithfully. */
  payload: string | null;
  payload_digest: string;
}

interface PluginRow {
  webhook_url: string | null;
  webhook_secret_vault_ref: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function loadSecret(db: SupabaseClient, ref: string): Promise<string | null> {
  const name = ref.startsWith('vault://') ? ref.slice('vault://'.length) : ref;
  const { data, error } = await db.rpc('vault_lookup', { secret_name: name });
  if (error) return null;
  return typeof data === 'string' ? data : null;
}

interface RetryOutcome {
  /** 'blocked'       — SSRF guard rejected the webhook URL (terminal).
   *  'unrecoverable' — no stored payload, replay impossible (terminal). */
  status: 'ok' | 'error' | 'timeout' | 'skipped' | 'blocked' | 'unrecoverable';
  httpStatus: number | null;
  durationMs: number;
  excerpt: string;
}

async function retryOne(db: SupabaseClient, row: ClaimedRow): Promise<RetryOutcome> {
  // Pre-20260816120000 rows stored only the digest, never the body. Replaying
  // a fabricated envelope would deliver a payload that matches neither the
  // digest nor the receiver's signature check, so finalise instead of lying.
  if (!row.payload) {
    return {
      status: 'unrecoverable',
      httpStatus: null,
      durationMs: 0,
      excerpt: 'no_stored_payload',
    };
  }

  const { data: plugin } = await db
    .from('project_plugins')
    .select('webhook_url, webhook_secret_vault_ref')
    .eq('project_id', row.project_id)
    .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`)
    .maybeSingle<PluginRow>();

  if (!plugin?.webhook_url || !plugin.webhook_secret_vault_ref) {
    return { status: 'skipped', httpStatus: null, durationMs: 0, excerpt: 'plugin_uninstalled' };
  }

  const secret = await loadSecret(db, plugin.webhook_secret_vault_ref);
  if (!secret) {
    return { status: 'skipped', httpStatus: null, durationMs: 0, excerpt: 'missing_secret' };
  }

  // Replay the ORIGINAL bytes: same webhook-id (receiver-side dedupe still
  // recognises the delivery it may already have accepted) but a fresh
  // timestamp + signature, because Standard Webhooks receivers reject
  // timestamps outside a ±5 minute window and a 6h-backoff retry would
  // otherwise always fail verification.
  const result = await postSignedWebhook({
    url: plugin.webhook_url,
    secret,
    event: row.event,
    projectId: row.project_id,
    pluginSlug: row.plugin_slug,
    deliveryId: row.delivery_id,
    rawBody: row.payload,
    retryAttempt: row.attempt + 1,
    timeoutMs: DISPATCH_TIMEOUT_MS,
  });

  return {
    status: result.status,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    excerpt: result.excerpt.slice(0, RESPONSE_EXCERPT_MAX),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const authResult = requireServiceRoleAuth(req);
  if (authResult) return authResult;

  const db = getServiceClient();
  const cron = await startCronRun(db, 'plugin-dispatch-retry', 'cron');

  try {
    // ── 1. CLAIM a batch of due rows (atomic lease, not a plain read) ──
    // FOR UPDATE SKIP LOCKED inside the RPC: an overlapping tick gets a
    // disjoint set instead of re-sending the deliveries this tick is
    // still working through.
    const { data: claimed, error: claimErr } = await db.rpc('claim_plugin_dispatch_retries', {
      p_limit: BATCH_SIZE,
    });
    if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);

    const rows = (claimed ?? []) as ClaimedRow[];
    plog.info('plugin-dispatch-retry.start', { rows: rows.length });

    let succeeded = 0;
    let failed = 0;
    let exhausted = 0;
    let unrecoverable = 0;
    // Loop-closure: paged at the end of the run so a single dead webhook
    // doesn't spam the operator channel on every retry tick. We collect
    // unique (project, plugin) pairs that exhausted retries this tick
    // and send one notification per pair below.
    const exhaustedPairs = new Map<
      string,
      { projectId: string; pluginSlug: string; lastError: string }
    >();

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (row) => {
          const outcome = await retryOne(db, row);
          return { row, outcome };
        }),
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') {
          // Lease is left in place; the row is reclaimed after the 5-minute
          // stale-lease window rather than being retried immediately.
          plog.warn('retry threw', { error: String(r.reason) });
          continue;
        }
        const { row, outcome } = r.value;

        // ── Decide next status / next_retry_at based on outcome ───────
        // 'unrecoverable' is terminal and does NOT count an attempt: nothing
        // was sent, and the plugin is not at fault, so it never pages and
        // never stamps last_delivery_status.
        const isUnrecoverable = outcome.status === 'unrecoverable';
        const newAttempt = isUnrecoverable ? row.attempt : row.attempt + 1;

        const isFinalOk = outcome.status === 'ok';
        // 'blocked' = SSRF guard rejected the URL; it will not become safe on
        // the next tick, so it is terminal like an uninstalled plugin.
        const isPermanentFail =
          !isUnrecoverable &&
          (outcome.status === 'skipped' ||
            outcome.status === 'blocked' ||
            newAttempt >= MAX_ATTEMPTS);
        const willRetry = !isFinalOk && !isPermanentFail && !isUnrecoverable;
        const nextStatus: 'ok' | 'pending' | 'error' | 'unrecoverable' = isFinalOk
          ? 'ok'
          : isUnrecoverable
            ? 'unrecoverable'
            : willRetry
              ? 'pending'
              : 'error';
        // BACKOFF_MS is indexed 0..MAX_ATTEMPTS-1, lookup uses newAttempt-1
        // since attempt=1 was the original dispatch and attempt=2 is the
        // first retry.
        const nextRetryAt = willRetry
          ? new Date(
              Date.now() +
                withJitter(BACKOFF_MS[Math.min(newAttempt - 1, BACKOFF_MS.length - 1)]),
            ).toISOString()
          : null;

        const { error: updateErr } = await db
          .from('plugin_dispatch_log')
          .update({
            attempt: newAttempt,
            status: nextStatus,
            http_status: outcome.httpStatus,
            response_excerpt: outcome.excerpt || null,
            duration_ms: outcome.durationMs,
            next_retry_at: nextRetryAt,
            // Release the lease. Required for the short backoffs: a row still
            // holding its lease is only reclaimable after 5 minutes, which
            // would stretch the 30s and 2m hops out to 5m.
            claimed_at: null,
          })
          .eq('id', row.id);
        // Leaving the lease set on failure is the safe outcome — the row is
        // reclaimed in 5 minutes instead of being re-sent on the next tick.
        if (updateErr) plog.warn('row update failed', { id: row.id, error: updateErr.message });

        if (isUnrecoverable) {
          unrecoverable++;
          plog.warn('retry unrecoverable (no stored payload)', {
            id: row.id,
            deliveryId: row.delivery_id,
            pluginSlug: row.plugin_slug,
          });
        } else if (isFinalOk) {
          succeeded++;
          // Update the plugin row's last_delivery_at/status — only on
          // success or permanent-fail, never on intermediate retries.
          await db
            .from('project_plugins')
            .update({
              last_delivery_at: new Date().toISOString(),
              last_delivery_status: 'ok',
            })
            .eq('project_id', row.project_id)
            .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`);
        } else if (isPermanentFail) {
          exhausted++;
          await db
            .from('project_plugins')
            .update({
              last_delivery_at: new Date().toISOString(),
              last_delivery_status: 'error',
            })
            .eq('project_id', row.project_id)
            .or(`plugin_slug.eq.${row.plugin_slug},plugin_name.eq.${row.plugin_slug}`);
          // Dedup by (project, plugin) so flooding 50 events through a
          // dead webhook only pages once per tick. We coalesce to one
          // notification at the end of the run.
          exhaustedPairs.set(`${row.project_id}::${row.plugin_slug}`, {
            projectId: row.project_id,
            pluginSlug: row.plugin_slug,
            lastError: outcome.excerpt || `HTTP ${outcome.httpStatus ?? 'unknown'}`,
          });
        } else {
          failed++;
        }
      }
    }

    // Loop-closure: page the operator once per (project, plugin) that
    // exhausted retries this tick. Best-effort — Slack/Discord outages
    // must not 500 the cron and force pg_cron into back-off.
    if (exhaustedPairs.size > 0) {
      const ADMIN_BASE = Deno.env.get('MUSHI_ADMIN_BASE_URL') ?? 'https://kensaur.us/mushi-mushi/admin';
      for (const pair of exhaustedPairs.values()) {
        try {
          await notifyOperator({
            title: `Plugin delivery exhausted: ${pair.pluginSlug}`,
            body: `Mushi gave up after ${MAX_ATTEMPTS} attempts (30s + 2m + 10m + 1h + 6h backoff). The plugin's *last_delivery_status* is now \`error\` and downstream events for this project will be dropped until the webhook is reachable again.`,
            level: 'urgent',
            fields: [
              { label: 'Project', value: pair.projectId.slice(0, 8) },
              { label: 'Plugin', value: pair.pluginSlug },
              { label: 'Last error', value: pair.lastError.slice(0, 200) },
            ],
            url: `${ADMIN_BASE}/marketplace?project=${pair.projectId}`,
            footer: 'mushi-mushi · plugin-dispatch-retry',
          });
        } catch (err) {
          plog.warn('operator notify failed (non-fatal)', {
            projectId: pair.projectId,
            pluginSlug: pair.pluginSlug,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    await cron.finish({
      rowsAffected: rows.length,
      metadata: {
        rows: rows.length,
        succeeded,
        failed,
        exhausted,
        unrecoverable,
        exhaustedPairs: exhaustedPairs.size,
      },
    });
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          processed: rows.length,
          succeeded,
          failed,
          exhausted,
          unrecoverable,
          exhaustedPairs: exhaustedPairs.size,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    await cron.fail(err);
    return safeErrorResponse({ code: 'RETRY_FAILED', status: 500 });
  }
}

if (typeof Deno !== 'undefined') {
  Deno.serve(withSentry('plugin-dispatch-retry', handler));
}
