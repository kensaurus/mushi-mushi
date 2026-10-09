/**
 * FILE: packages/server/supabase/functions/_shared/report-origin.ts
 * PURPOSE: Tell reports sent from a developer's machine from reports sent by
 *          a deployed app, for the reports list "Where" filter.
 *
 * 11 of 61 reports on 2026-10-09 came from a local dev server (Expo web on
 * localhost:8081, Vite on localhost:5174) and were not product bugs: the dev
 * origin is blocked by production CORS, or the dev server mixed two React
 * copies. Sentry drops events from localhost at ingest (Inbound Filters);
 * Mushi keeps them, because "send a test bug from your dev server" is part of
 * setup, and lets the list hide or show them instead.
 *
 * Local means the page URL's host is:
 * - a loopback host WITH a port (localhost:5173, 127.0.0.1:8081). A
 *   Capacitor app in production runs from https://localhost or
 *   capacitor://localhost with no port, and those are real users;
 * - a private network address (10.x, 192.168.x, 172.16–31.x): a phone on the
 *   dev machine's Wi-Fi, e.g. Expo or Capacitor live reload;
 * - a *.localhost, *.local or *.test name.
 *
 * The pattern is POSIX ERE so Postgres (`~*`, PostgREST `imatch`) and
 * JavaScript (`new RegExp(..., 'i')`) agree. The admin console keeps a copy in
 * apps/admin/src/lib/reportOrigin.ts; both test the same cases.
 */

export const LOCAL_DEV_URL_PATTERN =
  '^[a-z][a-z0-9+.-]*://(' +
  '(localhost|127\\.[0-9.]+|0\\.0\\.0\\.0|\\[::1\\]):[0-9]+' +
  '|(10|192\\.168|172\\.(1[6-9]|2[0-9]|3[01]))\\.[0-9.]+(:[0-9]+)?' +
  '|[a-z0-9.-]+\\.(localhost|local|test)(:[0-9]+)?' +
  ')([/?#]|$)'

const LOCAL_DEV_URL_RE = new RegExp(LOCAL_DEV_URL_PATTERN, 'i')

export function isLocalDevUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && LOCAL_DEV_URL_RE.test(url)
}

/** Values of the reports list `origin` filter. */
export const REPORT_ORIGIN_FILTERS = ['local', 'deployed'] as const

/**
 * PostgREST filter for one `origin` value: `local` is a URL match; `deployed`
 * is everything else, including reports with no page URL (native apps, Sentry
 * imports), which `NOT imatch` alone would drop.
 */
export function reportOriginFilter(
  origin: string,
): { kind: 'filter'; column: string; operator: string; value: string } | { kind: 'or'; clause: string } | null {
  if (origin === 'local') {
    return { kind: 'filter', column: 'environment->>url', operator: 'imatch', value: LOCAL_DEV_URL_PATTERN }
  }
  if (origin === 'deployed') {
    return { kind: 'or', clause: `environment->>url.is.null,environment->>url.not.imatch."${LOCAL_DEV_URL_PATTERN}"` }
  }
  return null
}
