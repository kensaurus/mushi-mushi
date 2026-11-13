/**
 * FILE: edge-canary.ts
 * PURPOSE: Edge canaries (ADR 0061): deterministic HTTP checks of a live
 *          site's edge (CDN redirects, host canonicalisation, missing-asset
 *          answers, app roots) that the live-site watch cannot make, because
 *          Firecrawl's browser follows every redirect.
 *
 * One `edge_canaries` row per check: a URL, the statuses that pass, and
 * optionally the exact Location a redirect must send. Each run fetches the
 * URL once with `redirect: 'manual'` (so a 301 is seen as a 301 and no page
 * script runs), the MushiSiteWatch User-Agent, no cookies. A failure is
 * fetched again a few seconds later in the same run; only a second failure
 * counts. Filing follows ADR 0029: a canary files when it fails in two runs
 * in a row (`fail_streak >= 2`), one report per canary, or ONE report for a
 * burst of failures in the same project (the edge is down). A canary with
 * an open report does not file again; once that report is closed and the
 * canary fails again, it files a new one. A canary that passes again resets
 * its streak and leaves its report for a person, as the site watch does.
 *
 * Runs from site-watch-poll's hourly cron pass only (not "Check now"), so
 * two runs never overlap and a streak counts hours. No Firecrawl call, no
 * credits.
 * Pure apart from the injected db and fetch; vitest runs it on stubs.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { MONITOR_USER_AGENT } from './monitor-url.ts';

export interface CanaryRow {
  id: string;
  project_id: string;
  label: string;
  url: string;
  expect_status: number[];
  expect_location: string | null;
  fail_streak: number | null;
  report_id: string | null;
  failing_since: string | null;
}

export interface CanaryObservation {
  /** HTTP status, or -1 when the request failed (DNS, TLS, timeout). */
  status: number;
  /** The Location header resolved against the request URL, else null. */
  location: string | null;
  error?: string;
}

export interface CanaryVerdict {
  pass: boolean;
  /** One sentence: what was expected and what came back. */
  detail: string;
}

/** The Location header as an absolute URL (it may be relative), else null. */
export function resolveLocation(location: string | null, requestUrl: string): string | null {
  if (!location) return null;
  try {
    return new URL(location, requestUrl).href;
  } catch {
    return location;
  }
}

function describe(o: CanaryObservation): string {
  if (o.status === -1) return `no answer (${o.error ?? 'request failed'})`;
  return o.location ? `${o.status} to ${o.location}` : String(o.status);
}

/** Whether one observation passes the canary. */
export function evaluateCanary(c: Pick<CanaryRow, 'url' | 'expect_status' | 'expect_location'>, o: CanaryObservation): CanaryVerdict {
  const want = `${c.expect_status.join(' or ')}${c.expect_location ? ` to ${c.expect_location}` : ''}`;
  const got = describe(o);
  if (!c.expect_status.includes(o.status)) return { pass: false, detail: `${c.url} should answer ${want}; it answered ${got}.` };
  if (c.expect_location) {
    const expected = resolveLocation(c.expect_location, c.url);
    if (o.location !== expected) return { pass: false, detail: `${c.url} should answer ${want}; it answered ${got}.` };
  }
  return { pass: true, detail: `${c.url} answered ${got}.` };
}

export const CANARY_TIMEOUT_MS = 10_000;
export const CANARY_RECHECK_DELAY_MS = 3_000;
/** This many canaries of one project filing in one run become one report. */
export const CANARY_OUTAGE_THRESHOLD = 5;

/** Fetch a canary URL once, no redirect followed, body discarded. */
export async function observeCanary(url: string, fetchImpl: typeof fetch = fetch): Promise<CanaryObservation> {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': MONITOR_USER_AGENT, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(CANARY_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    return { status: res.status, location: resolveLocation(res.headers.get('location'), url) };
  } catch (err) {
    return { status: -1, location: null, error: String(err instanceof Error ? err.message : err).slice(0, 160) };
  }
}

function severityFor(c: Pick<CanaryRow, 'expect_status'>, o: CanaryObservation): 'high' | 'medium' {
  // The edge failing (5xx, unreachable) or an app root that stopped answering 200 is high;
  // a redirect or missing-asset answer that drifted is medium.
  if (o.status === -1 || o.status >= 500) return 'high';
  if (c.expect_status.includes(200) && o.status !== 200) return 'high';
  return 'medium';
}

/** The report one failing canary becomes. */
export function buildCanaryReport(c: CanaryRow, o: CanaryObservation, verdict: CanaryVerdict, now: Date): Record<string, unknown> {
  const nowIso = now.toISOString();
  return {
    id: crypto.randomUUID(),
    project_id: c.project_id,
    title: `Live site edge: ${c.label} answers ${describe(o)}`.slice(0, 200),
    description:
      `${verdict.detail}\n\n` +
      'Seen again: it failed twice within this check, and in the check an hour before.\n\n' +
      `Canary: ${c.label}\nURL: ${c.url}\nExpected: ${c.expect_status.join(' or ')}${c.expect_location ? `, Location ${c.expect_location}` : ''}\n\n` +
      'Found by an edge canary of the live-site watch: a plain request with no redirect followed and no page script, ' +
      'so it sees exactly what the CDN answers. No user reported this yet.\n\n' +
      `Done when: ${c.url} answers ${c.expect_status.join(' or ')}${c.expect_location ? ` with Location ${c.expect_location}` : ''} (curl -sI '${c.url}').`,
    category: 'bug',
    severity: severityFor(c, o),
    status: 'new',
    source: 'site_watch',
    reporter_token_hash: 'site-watch',
    environment: { userAgent: 'site-watch', platform: 'web', language: '', url: c.url, referrer: '', timestamp: nowIso, timezone: 'UTC' },
    custom_metadata: {
      source: 'edge_canary',
      canaryId: c.id,
      label: c.label,
      url: c.url,
      expected: { status: c.expect_status, location: c.expect_location },
      observed: { status: o.status, location: o.location, error: o.error ?? null },
    },
    synced_at: nowIso,
    created_at: nowIso,
  };
}

/** One report for a burst of canaries failing together in one project. */
export function buildCanaryOutageReport(
  projectId: string,
  failing: Array<{ c: CanaryRow; o: CanaryObservation; verdict: CanaryVerdict }>,
  now: Date,
): Record<string, unknown> {
  const nowIso = now.toISOString();
  const lines = failing.slice(0, 25).map((f) => `- ${f.c.label}: ${f.verdict.detail}`);
  const down = failing.some((f) => f.o.status === -1 || f.o.status >= 500);
  return {
    id: crypto.randomUUID(),
    project_id: projectId,
    title: `Live site edge: ${failing.length} canaries failed at once`.slice(0, 200),
    description:
      `${failing.length} edge canaries failed in two checks in a row, which usually means one cause ` +
      '(the CDN or its edge function changed, or the origin is down).\n\n' +
      `${lines.join('\n')}\n\n` +
      'Found by the edge canaries of the live-site watch (no redirect followed, no page script). No user reported this yet.',
    category: 'bug',
    severity: down ? 'critical' : 'high',
    status: 'new',
    source: 'site_watch',
    reporter_token_hash: 'site-watch',
    environment: { userAgent: 'site-watch', platform: 'web', language: '', url: failing[0]?.c.url ?? '', referrer: '', timestamp: nowIso, timezone: 'UTC' },
    custom_metadata: {
      source: 'edge_canary',
      outage: true,
      canaries: failing.slice(0, 25).map((f) => ({ canaryId: f.c.id, url: f.c.url, status: f.o.status, location: f.o.location })),
      canaryCount: failing.length,
    },
    synced_at: nowIso,
    created_at: nowIso,
  };
}

const CLOSED_REPORT_STATUSES: ReadonlySet<string> = new Set(['fixed', 'resolved', 'verified', 'dismissed']);

export interface CanaryRunDeps {
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  classify: (db: SupabaseClient, reportId: string, projectId: string) => Promise<void> | void;
}

export interface CanaryRunResult {
  checked: number;
  failing: number;
  filed: number;
  reports: number;
}

/** Run every enabled canary (optionally one project's) and file what failed twice in a row. */
export async function runEdgeCanaries(db: SupabaseClient, deps: CanaryRunDeps, opts: { projectId?: string | null } = {}): Promise<CanaryRunResult> {
  let q = db
    .from('edge_canaries')
    .select('id, project_id, label, url, expect_status, expect_location, fail_streak, report_id, failing_since')
    .eq('enabled', true);
  if (opts.projectId) q = q.eq('project_id', opts.projectId);
  const { data, error } = await q;
  if (error) throw new Error(`edge_canaries read failed: ${error.message}`);
  const canaries = (data ?? []) as CanaryRow[];
  const result: CanaryRunResult = { checked: canaries.length, failing: 0, filed: 0, reports: 0 };
  if (canaries.length === 0) return result;

  // Observe all, re-check the failures once after a short pause.
  const first = await Promise.all(canaries.map((c) => observeCanary(c.url, deps.fetch)));
  const verdicts = canaries.map((c, i) => ({ c, o: first[i], verdict: evaluateCanary(c, first[i]) }));
  const failedOnce = verdicts.filter((v) => !v.verdict.pass);
  if (failedOnce.length > 0) {
    await deps.sleep(CANARY_RECHECK_DELAY_MS);
    await Promise.all(
      failedOnce.map(async (v) => {
        const o = await observeCanary(v.c.url, deps.fetch);
        v.o = o;
        v.verdict = evaluateCanary(v.c, o);
      }),
    );
  }

  const now = deps.now();
  const nowIso = now.toISOString();

  // Which open reports are still open.
  const reportIds = [...new Set(canaries.map((c) => c.report_id).filter((id): id is string => Boolean(id)))];
  const openReports = new Set<string>();
  if (reportIds.length > 0) {
    const { data: reps, error: repErr } = await db.from('reports').select('id, status').in('id', reportIds);
    if (repErr) throw new Error(`reports read failed: ${repErr.message}`);
    for (const r of (reps ?? []) as Array<{ id: string; status: string | null }>) {
      if (!CLOSED_REPORT_STATUSES.has(r.status ?? '')) openReports.add(r.id);
    }
  }

  const toFile = new Map<string, Array<(typeof verdicts)[number]>>();
  for (const v of verdicts) {
    const base = { last_status: v.o.status, last_location: v.o.location, last_detail: v.verdict.detail.slice(0, 500), last_checked_at: nowIso, updated_at: nowIso };
    if (v.verdict.pass) {
      const { error: upErr } = await db.from('edge_canaries').update({ ...base, fail_streak: 0, failing_since: null }).eq('id', v.c.id);
      if (upErr) throw new Error(`edge_canaries update failed: ${upErr.message}`);
      continue;
    }
    result.failing++;
    const streak = (v.c.fail_streak ?? 0) + 1;
    const { error: upErr } = await db
      .from('edge_canaries')
      .update({ ...base, fail_streak: streak, failing_since: v.c.failing_since ?? nowIso })
      .eq('id', v.c.id);
    if (upErr) throw new Error(`edge_canaries update failed: ${upErr.message}`);
    const hasOpenReport = v.c.report_id ? openReports.has(v.c.report_id) : false;
    if (streak >= 2 && !hasOpenReport) {
      const list = toFile.get(v.c.project_id) ?? [];
      list.push(v);
      toFile.set(v.c.project_id, list);
    }
  }

  for (const [projectId, list] of toFile) {
    const groups =
      list.length >= CANARY_OUTAGE_THRESHOLD
        ? [{ report: buildCanaryOutageReport(projectId, list, now), members: list }]
        : list.map((v) => ({ report: buildCanaryReport(v.c, v.o, v.verdict, now), members: [v] }));
    for (const g of groups) {
      const reportId = g.report.id as string;
      const { error: insErr } = await db.from('reports').insert(g.report);
      if (insErr) throw new Error(`edge canary report insert failed: ${insErr.message}`);
      const { error: linkErr } = await db
        .from('edge_canaries')
        .update({ report_id: reportId })
        .in('id', g.members.map((m) => m.c.id));
      if (linkErr) throw new Error(`edge_canaries link failed: ${linkErr.message}`);
      result.reports++;
      result.filed += g.members.length;
      await deps.classify(db, reportId, projectId);
    }
  }
  return result;
}
