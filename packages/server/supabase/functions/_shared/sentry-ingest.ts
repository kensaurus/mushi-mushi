/**
 * FILE: sentry-ingest.ts
 * PURPOSE: Turn Sentry error webhooks into first-class Mushi reports.
 *
 * Before this module, the hosted `/v1/webhooks/sentry` endpoint consumed ONLY
 * Sentry User Feedback — an error issue firing an alert was `{action:
 * 'ignored'}`. That made "Mushi sits between your monitoring and your fix
 * loop" a docs-only claim: real crash telemetry never entered the queue.
 *
 * Handles two Sentry webhook resources:
 *   - `event_alert` (issue alert fired): `data.event` carries the full event —
 *     title, culprit, level, exception stack, tags, request URL.
 *   - `issue` (action created/resolved/…): `data.issue` carries the grouped
 *     issue summary.
 *
 * Dedup: one Mushi report per Sentry issue, linked through
 * `report_external_issues (system='sentry', external_id=<issueId>)` — the same
 * table plugin-sentry uses for the outbound mirror, so the resolve loop is
 * genuinely bidirectional: Mushi fix → Sentry resolve (plugin), Sentry
 * resolve → Mushi resolved (here). A repeat alert for an already-fixed report
 * reopens it and bumps `regression_count` instead of filing a duplicate.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { log as rootLog } from './logger.ts';
import { applyReportStatusTransition } from './report-transition.ts';

const log = rootLog.child('sentry-ingest');

/** Sentry event level → Mushi severity. */
export function mapSentryLevelToSeverity(level: string | undefined | null): string {
  switch ((level ?? '').toLowerCase()) {
    case 'fatal':
      return 'critical';
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    default:
      return 'low';
  }
}

interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
}

interface SentryExceptionValue {
  type?: string;
  value?: string;
  stacktrace?: { frames?: SentryFrame[] };
}

export interface SentryEventPayload {
  event_id?: string;
  title?: string;
  culprit?: string;
  level?: string;
  environment?: string;
  release?: string;
  platform?: string;
  web_url?: string;
  issue_url?: string;
  issue_id?: string | number;
  request?: { url?: string };
  tags?: Array<[string, string]>;
  exception?: { values?: SentryExceptionValue[] };
}

export interface SentryIssuePayload {
  id?: string | number;
  title?: string;
  culprit?: string;
  shortId?: string;
  level?: string;
  permalink?: string;
  firstSeen?: string;
  platform?: string;
}

function tagValue(tags: Array<[string, string]> | undefined, key: string): string | null {
  if (!Array.isArray(tags)) return null;
  const hit = tags.find((t) => Array.isArray(t) && t[0] === key);
  return hit?.[1] ?? null;
}

/** Render the first exception's stack as compact text for `console_logs` —
 *  the same evidence bucket the SDK fills, so Stage 1/2 triage reads it with
 *  zero special-casing. Bounded to the last 10 frames. */
export function renderStackText(exception: SentryEventPayload['exception']): string | null {
  const first = exception?.values?.[0];
  if (!first) return null;
  const frames = first.stacktrace?.frames ?? [];
  const shown = frames.slice(-10).reverse();
  const lines = shown.map((f) => {
    const loc = [f.filename ?? '?', f.lineno].filter((v) => v != null).join(':');
    return `  at ${f.function ?? '<anonymous>'} (${loc})`;
  });
  return [`${first.type ?? 'Error'}: ${first.value ?? ''}`, ...lines].join('\n');
}

export interface SentryIngestResult {
  outcome: 'created' | 'deduped' | 'reopened' | 'resolved' | 'ignored';
  reportId?: string;
}

/** Statuses that mean "this was considered done" — a fresh Sentry alert on
 *  one of these is a regression, not a duplicate. */
const DONE_STATUSES = new Set(['fixed', 'resolved', 'verified', 'dismissed']);

async function findLinkedReport(
  db: SupabaseClient,
  projectId: string,
  sentryIssueId: string,
): Promise<{ reportId: string; status: string; regressionCount: number } | null> {
  const { data: link } = await db
    .from('report_external_issues')
    .select('report_id')
    .eq('project_id', projectId)
    .eq('system', 'sentry')
    .eq('external_id', sentryIssueId)
    .maybeSingle();
  if (!link?.report_id) return null;
  const { data: report } = await db
    .from('reports')
    .select('id, status, regression_count')
    .eq('id', link.report_id)
    .maybeSingle();
  if (!report) return null;
  return {
    reportId: report.id as string,
    status: (report.status as string) ?? 'new',
    regressionCount: (report.regression_count as number) ?? 0,
  };
}

/**
 * Ingest a Sentry error (event-alert or new-issue webhook) as a Mushi report.
 * Returns the outcome so the route can answer Sentry meaningfully.
 * `triggerClassification` is injected so this module stays free of the api
 * function's helper graph (and unit-testable).
 */
export async function ingestSentryError(
  db: SupabaseClient,
  input: {
    projectId: string;
    event?: SentryEventPayload | null;
    issue?: SentryIssuePayload | null;
    triggerClassification: (reportId: string, projectId: string) => void;
  },
): Promise<SentryIngestResult> {
  const { projectId, event, issue } = input;

  const sentryIssueId = String(event?.issue_id ?? issue?.id ?? '') || null;
  const title = event?.title ?? issue?.title ?? null;
  if (!title) return { outcome: 'ignored' };

  // ── Dedup / regression on the Sentry issue id ─────────────────────────────
  if (sentryIssueId) {
    const linked = await findLinkedReport(db, projectId, sentryIssueId);
    if (linked) {
      if (DONE_STATUSES.has(linked.status)) {
        // The fix didn't hold — reopen instead of filing a duplicate.
        await db
          .from('reports')
          .update({
            status: 'reopened',
            reopened_at: new Date().toISOString(),
            regressed_at: new Date().toISOString(),
            regression_count: linked.regressionCount + 1,
          })
          .eq('id', linked.reportId);
        log.info('Sentry alert reopened a fixed report', {
          reportId: linked.reportId,
          sentryIssueId,
        });
        return { outcome: 'reopened', reportId: linked.reportId };
      }
      return { outcome: 'deduped', reportId: linked.reportId };
    }
  }

  // ── Create the report ─────────────────────────────────────────────────────
  const reportId = crypto.randomUUID();
  const culprit = event?.culprit ?? issue?.culprit ?? null;
  const level = event?.level ?? issue?.level ?? 'error';
  const stackText = renderStackText(event?.exception);
  const pageUrl = event?.request?.url ?? '';
  const sentryUrl = event?.web_url ?? issue?.permalink ?? null;
  const release = event?.release ?? tagValue(event?.tags, 'release');
  const environment = event?.environment ?? tagValue(event?.tags, 'environment');

  const description = [
    title,
    culprit ? `in ${culprit}` : null,
    '(captured by Sentry — no user description)',
  ]
    .filter(Boolean)
    .join(' ');

  const { error: insertError } = await db.from('reports').insert({
    id: reportId,
    project_id: projectId,
    description,
    user_category: 'bug',
    category: 'bug',
    severity: mapSentryLevelToSeverity(level),
    status: 'new',
    reporter_token_hash: 'sentry-webhook',
    sentry_event_id: event?.event_id ?? null,
    sentry_issue_url: sentryUrl,
    sentry_release: release,
    sentry_environment: environment,
    console_logs: stackText
      ? [{ level: 'error', message: title, stack: stackText }]
      : null,
    custom_metadata: {
      source: 'sentry_webhook',
      kind: 'error_event',
      sentryIssueId,
      sentryShortId: issue?.shortId ?? null,
      culprit,
      platform: event?.platform ?? issue?.platform ?? null,
    },
    environment: {
      userAgent: 'sentry-webhook',
      platform: event?.platform ?? '',
      language: '',
      viewport: { width: 0, height: 0 },
      url: pageUrl || (sentryUrl ?? ''),
      referrer: '',
      timestamp: new Date().toISOString(),
      timezone: 'UTC',
    },
    created_at: new Date().toISOString(),
  });
  if (insertError) {
    log.error('Sentry ingest insert failed', { err: insertError.message, sentryIssueId });
    throw new Error(`Sentry ingest insert failed: ${insertError.message}`);
  }

  if (sentryIssueId) {
    // Link BEFORE classification so a racing second alert dedups against it.
    const { error: linkError } = await db.from('report_external_issues').insert({
      report_id: reportId,
      project_id: projectId,
      system: 'sentry',
      external_id: sentryIssueId,
      external_url: sentryUrl,
    });
    if (linkError) {
      // Unique-violation here means a concurrent delivery won the race —
      // treat ours as the duplicate and drop the just-inserted row.
      log.warn('Sentry link insert failed (likely concurrent delivery)', {
        err: linkError.message,
      });
    }
  }

  input.triggerClassification(reportId, projectId);
  return { outcome: 'created', reportId };
}

/**
 * Sentry-side resolve → Mushi resolve. Closes the loop in the inbound
 * direction; plugin-sentry already handles Mushi fix → Sentry resolve.
 */
export async function resolveReportFromSentry(
  db: SupabaseClient,
  projectId: string,
  sentryIssueId: string,
): Promise<SentryIngestResult> {
  const linked = await findLinkedReport(db, projectId, sentryIssueId);
  if (!linked) return { outcome: 'ignored' };
  if (DONE_STATUSES.has(linked.status)) return { outcome: 'deduped', reportId: linked.reportId };
  const result = await applyReportStatusTransition(db, {
    reportId: linked.reportId,
    requestedStatus: 'resolved',
    actor: { kind: 'system', id: 'sentry-webhook' },
  });
  if (!result.ok) {
    log.warn('Sentry-side resolve failed', { reportId: linked.reportId, err: result.message });
    return { outcome: 'ignored', reportId: linked.reportId };
  }
  return { outcome: 'resolved', reportId: linked.reportId };
}
