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

async function sentryFetch(
  fetchImpl: FetchLike,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetchImpl(`${SENTRY_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
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
export async function searchSentryIssues(
  token: string,
  org: string,
  projectSlug: string,
  query: string,
  limit: number,
  fetchImpl: FetchLike = defaultFetch,
): Promise<SentryRestIssue[]> {
  const qs = new URLSearchParams({ query, limit: String(limit) });
  return await sentryJson<SentryRestIssue[]>(
    fetchImpl,
    token,
    `/projects/${seg(org)}/${seg(projectSlug)}/issues/?${qs.toString()}`,
  );
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
