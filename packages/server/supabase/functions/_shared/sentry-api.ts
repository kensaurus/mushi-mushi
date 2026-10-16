/**
 * FILE: sentry-api.ts
 * PURPOSE: The handful of Sentry REST calls the import and resolve-back paths
 *          need, plus the mapping from the REST event shape to the webhook
 *          event shape `ingestSentryError` already understands.
 *
 * Every call takes an injectable `fetchImpl` (default: fetchWithTimeout) so
 * the logic is testable without the network. Token scopes:
 *   - read (import):   event:read  (project:read for the project-scoped search)
 *   - write (resolve): event:write
 */

import { isTransientDbConnectionError } from './error-codes.ts';
import { fetchWithTimeout } from './http.ts';
import type { SentryEventPayload } from './sentry-ingest.ts';

export const SENTRY_API_BASE = 'https://sentry.io/api/0';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const defaultFetch: FetchLike = (url, init) => fetchWithTimeout(url, init ?? {}, 10_000);

export class SentryApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SentryApiError';
  }
}

/**
 * The text of anything thrown. A PostgREST error is a plain object with a
 * `message`, which `String(err)` turns into "[object Object]".
 */
export function thrownMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

/**
 * Connection-level failures, matched narrowly: a refused or reset socket,
 * a DNS miss, an Envoy "upstream connect error". A bare "connection" would
 * also match config errors, which must keep reaching Sentry.
 */
const TRANSIENT_NETWORK =
  /upstream connect error|delayed connect error|error sending request|tcp connect error|connection refused|connection reset|connection closed before message completed|econnrefused|econnreset|socket hang up|dns error|failed to lookup address/i;

/**
 * True when a Sentry poll failed for a reason the next poll will retry on its
 * own: Sentry answered 5xx or 429, the request timed out, or the connection
 * failed (MUSHI-MUSHI-SERVER-2P: a 503 "upstream connect error ... Connection
 * refused" from Sentry's own edge). A poll also reads settings from the
 * database first: a plain error object is a PostgREST error and goes to the
 * DB classifier, which never silences a coded SQL error. 401/403/404 and
 * anything else stay real errors.
 */
export function isTransientSentryFailure(err: unknown): boolean {
  if (err instanceof SentryApiError) return err.status >= 500 || err.status === 429;
  // AbortSignal.timeout() rejects with a DOMException named TimeoutError.
  const name = err && typeof err === 'object' ? (err as { name?: unknown }).name : undefined;
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  if (err && typeof err === 'object' && !(err instanceof Error)) {
    return isTransientDbConnectionError(err as { message?: string; code?: string | null });
  }
  return TRANSIENT_NETWORK.test(thrownMessage(err));
}

export interface SentryRestIssue {
  id: string;
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  permalink?: string;
  platform?: string;
  status?: string;
  project?: { id?: string; slug?: string } | null;
}

interface SentryRestFrame {
  filename?: string | null;
  absPath?: string | null;
  function?: string | null;
  lineNo?: number | null;
  colNo?: number | null;
  inApp?: boolean | null;
}

export interface SentryRestEvent {
  eventID?: string;
  id?: string;
  title?: string;
  culprit?: string;
  platform?: string;
  release?: { version?: string } | null;
  tags?: Array<{ key: string; value: string }>;
  entries?: Array<{ type: string; data?: unknown }>;
  /** The REST event's `extra` lives under `context`. */
  context?: Record<string, unknown> | null;
}

/** Retries after a 429 before the caller sees it. */
const SENTRY_429_RETRIES = 2;
/** Longest Retry-After we wait inside one request; a longer one is left to the next poll. */
const SENTRY_429_MAX_WAIT_MS = 5_000;

/**
 * Milliseconds to wait before retrying a 429, from its Retry-After header
 * (seconds or an HTTP date). Sentry's org limit is "5 requests in 1 second",
 * so a missing header waits 1 s.
 */
export function sentryRetryAfterMs(res: Response, now = Date.now()): number {
  const raw = res.headers.get('Retry-After');
  if (!raw) return 1_000;
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(raw) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 1_000;
}

async function sentryFetch(
  fetchImpl: FetchLike,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = () =>
    fetchImpl(`${SENTRY_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  // The auto-import polls several projects at once against one org rate
  // limit, so a 429 is routine: wait as Sentry asks and try again, instead of
  // failing the project's whole run (2026-10-16: 91 such warnings a day).
  // A 429 means the request was not processed, so retrying a write is safe.
  let res = await request();
  for (let attempt = 0; attempt < SENTRY_429_RETRIES && res.status === 429; attempt++) {
    const waitMs = sentryRetryAfterMs(res);
    if (waitMs > SENTRY_429_MAX_WAIT_MS) break;
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, waitMs));
    res = await request();
  }
  return res;
}

async function sentryJson<T>(fetchImpl: FetchLike, token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await sentryFetch(fetchImpl, token, path, init);
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new SentryApiError(res.status, `Sentry ${init?.method ?? 'GET'} ${path.split('?')[0]} → ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

const seg = encodeURIComponent;

/** Numeric issue id or short id (`GLOT-IT-C4`) → the issue. */
export async function getSentryIssue(
  token: string,
  org: string,
  idOrShortId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SentryRestIssue> {
  if (/^\d+$/.test(idOrShortId)) {
    return await sentryJson<SentryRestIssue>(fetchImpl, token, `/organizations/${seg(org)}/issues/${seg(idOrShortId)}/`);
  }
  const resolved = await sentryJson<{ group?: SentryRestIssue; groupId?: string }>(
    fetchImpl,
    token,
    `/organizations/${seg(org)}/shortids/${seg(idOrShortId)}/`,
  );
  if (resolved.group?.id) return resolved.group;
  if (resolved.groupId) {
    return await sentryJson<SentryRestIssue>(fetchImpl, token, `/organizations/${seg(org)}/issues/${seg(resolved.groupId)}/`);
  }
  throw new SentryApiError(404, `Sentry short id ${idOrShortId} did not resolve to an issue`);
}

export async function getLatestSentryEvent(
  token: string,
  org: string,
  issueId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SentryRestEvent> {
  return await sentryJson<SentryRestEvent>(
    fetchImpl,
    token,
    `/organizations/${seg(org)}/issues/${seg(issueId)}/events/latest/`,
  );
}

/** Issues in ONE Sentry project matching a Sentry search query. */
export interface SentryIssuePage {
  issues: SentryRestIssue[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  nextCursor: string | null;
}

/**
 * Sentry always sends a rel="next" link, even on the last page; its
 * results="true|false" attribute says whether it leads anywhere.
 */
export function parseSentryNextCursor(link: string | null | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    if (!/rel="next"/.test(part)) continue;
    if (!/results="true"/.test(part)) return null;
    return part.match(/cursor="([^"]+)"/)?.[1] ?? null;
  }
  return null;
}

export async function searchSentryIssues(
  token: string,
  org: string,
  projectSlug: string,
  page: { query: string; limit: number; cursor?: string },
  fetchImpl: FetchLike = defaultFetch,
): Promise<SentryIssuePage> {
  const qs = new URLSearchParams({ query: page.query, limit: String(page.limit) });
  if (page.cursor) qs.set('cursor', page.cursor);
  const path = `/projects/${seg(org)}/${seg(projectSlug)}/issues/?${qs.toString()}`;
  const res = await sentryFetch(fetchImpl, token, path);
  if (!res.ok) {
    const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new SentryApiError(res.status, `Sentry GET ${path.split('?')[0]} → ${res.status} ${detail}`.trim());
  }
  return {
    issues: (await res.json()) as SentryRestIssue[],
    nextCursor: parseSentryNextCursor(res.headers.get('link')),
  };
}

/**
 * Resolve an issue. Tries `resolvedInNextRelease` first so a regression in a
 * later release reopens it; a project without release tracking rejects that
 * with a 4xx, and we fall back to plain `resolved`.
 */
export async function resolveSentryIssue(
  token: string,
  org: string,
  issueId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ status: 'resolvedInNextRelease' | 'resolved' }> {
  const path = `/organizations/${seg(org)}/issues/${seg(issueId)}/`;
  const first = await sentryFetch(fetchImpl, token, path, {
    method: 'PUT',
    body: JSON.stringify({ status: 'resolvedInNextRelease' }),
  });
  if (first.ok) return { status: 'resolvedInNextRelease' };
  if (first.status !== 400 && first.status !== 422) {
    const detail = await first.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new SentryApiError(first.status, `Sentry resolve → ${first.status} ${detail}`.trim());
  }
  await sentryJson<unknown>(fetchImpl, token, path, {
    method: 'PUT',
    body: JSON.stringify({ status: 'resolved' }),
  });
  return { status: 'resolved' };
}

/**
 * Archive an issue until it escalates (Sentry's default "Archive"): it leaves
 * the unresolved list but comes back if its volume jumps.
 */
export async function archiveSentryIssue(
  token: string,
  org: string,
  issueId: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  await sentryJson<unknown>(fetchImpl, token, `/organizations/${seg(org)}/issues/${seg(issueId)}/`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'ignored', substatus: 'archived_until_escalating' }),
  });
}

export async function commentOnSentryIssue(
  token: string,
  org: string,
  issueId: string,
  text: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  await sentryJson<unknown>(fetchImpl, token, `/organizations/${seg(org)}/issues/${seg(issueId)}/comments/`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/** REST issue + latest event → the webhook `data.event` shape. */
export function restEventToWebhookEvent(issue: SentryRestIssue, event: SentryRestEvent | null): SentryEventPayload {
  const entries = event?.entries ?? [];
  const exceptionEntry = entries.find((e) => e.type === 'exception')?.data as
    | { values?: Array<{ type?: string; value?: string; stacktrace?: { frames?: SentryRestFrame[] } | null }> }
    | undefined;
  const requestEntry = entries.find((e) => e.type === 'request')?.data as { url?: string } | undefined;
  const tags: Array<[string, string]> = (event?.tags ?? [])
    .filter((t) => t && typeof t.key === 'string')
    .map((t) => [t.key, String(t.value ?? '')]);
  const tag = (k: string) => tags.find((t) => t[0] === k)?.[1] ?? undefined;

  return {
    event_id: event?.eventID ?? event?.id,
    title: event?.title ?? issue.title,
    culprit: event?.culprit ?? issue.culprit,
    level: tag('level') ?? issue.level,
    environment: tag('environment'),
    release: event?.release?.version ?? tag('release'),
    platform: event?.platform ?? issue.platform,
    web_url: issue.permalink,
    issue_id: issue.id,
    request: requestEntry?.url ? { url: requestEntry.url } : undefined,
    tags,
    exception: exceptionEntry?.values
      ? {
          values: exceptionEntry.values.map((v) => ({
            type: v.type,
            value: v.value,
            stacktrace: {
              frames: (v.stacktrace?.frames ?? []).map((f) => ({
                filename: f.filename ?? undefined,
                abs_path: f.absPath ?? undefined,
                function: f.function ?? undefined,
                lineno: f.lineNo ?? undefined,
                colno: f.colNo ?? undefined,
                in_app: f.inApp ?? undefined,
              })),
            },
          })),
        }
      : undefined,
    extra: event?.context ?? null,
  };
}
