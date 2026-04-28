import {
  MUSHI_INTERNAL_HEADER,
  MUSHI_INTERNAL_INIT_MARKER,
  type MushiInternalRequestKind,
  type MushiUrlMatcher,
} from '@mushi-mushi/core';

export interface InternalRequestOptions {
  apiEndpoint?: string;
  ignoreUrls?: MushiUrlMatcher[];
}

export const DEFAULT_INTERNAL_URL_MATCHERS: MushiUrlMatcher[] = [
  /\/v1\/sdk(?:\/|$)/,
  /\/v1\/reports(?:\/|$)/,
  /\/v1\/notifications(?:\/|$)/,
  /\/v1\/reputation(?:\/|$)/,
];

export function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function getInternalRequestKind(
  input: RequestInfo | URL,
  init?: RequestInit,
): MushiInternalRequestKind | null {
  const marker = (init as (RequestInit & { [MUSHI_INTERNAL_INIT_MARKER]?: MushiInternalRequestKind }) | undefined)
    ?.[MUSHI_INTERNAL_INIT_MARKER];
  if (marker) return marker;

  const initHeader = readHeader(init?.headers, MUSHI_INTERNAL_HEADER);
  if (initHeader) return initHeader as MushiInternalRequestKind;

  if (typeof Request !== 'undefined' && input instanceof Request) {
    const requestHeader = input.headers.get(MUSHI_INTERNAL_HEADER);
    if (requestHeader) return requestHeader as MushiInternalRequestKind;
  }

  return null;
}

export function shouldIgnoreMushiUrl(url: string, options: InternalRequestOptions = {}): boolean {
  const matchers = [...DEFAULT_INTERNAL_URL_MATCHERS, ...(options.ignoreUrls ?? [])];
  if (matchers.some((matcher) => matchesUrl(url, matcher))) return true;

  const endpoint = normalizeUrlPrefix(options.apiEndpoint);
  return endpoint ? normalizeComparableUrl(url).startsWith(endpoint) : false;
}

export function matchesUrl(url: string, matcher: MushiUrlMatcher): boolean {
  if (typeof matcher === 'string') {
    return normalizeComparableUrl(url).includes(matcher);
  }
  matcher.lastIndex = 0;
  return matcher.test(url);
}

export function normalizeUrlPrefix(url?: string): string | null {
  if (!url) return null;
  return normalizeComparableUrl(url).replace(/\/+$/, '');
}

export function isLocalhostEndpoint(url?: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1'
      || parsed.hostname.endsWith('.localhost');
  } catch {
    return /\blocalhost\b|127\.0\.0\.1/.test(url);
  }
}

function normalizeComparableUrl(url: string): string {
  try {
    return new URL(url, typeof location !== 'undefined' ? location.href : 'http://localhost').href;
  } catch {
    return url;
  }
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}
