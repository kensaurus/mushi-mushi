/**
 * FILE: apps/admin/src/lib/reportOrigin.ts
 * PURPOSE: Was this report sent from a developer's machine? Drives the
 *          "Local dev" chip and the reports list "Where" filter.
 *
 * Copy of packages/server/supabase/functions/_shared/report-origin.ts (the
 * server filters the list with the same pattern). Loopback counts only with a
 * port: a Capacitor app in production runs from https://localhost.
 */

const LOCAL_DEV_URL_RE = new RegExp(
  '^[a-z][a-z0-9+.-]*://(' +
    '(localhost|127\\.[0-9.]+|0\\.0\\.0\\.0|\\[::1\\]):[0-9]+' +
    '|(10|192\\.168|172\\.(1[6-9]|2[0-9]|3[01]))\\.[0-9.]+(:[0-9]+)?' +
    '|[a-z0-9.-]+\\.(localhost|local|test)(:[0-9]+)?' +
    ')([/?#]|$)',
  'i',
)

export function isLocalDevUrl(url: string | null | undefined): boolean {
  return typeof url === 'string' && LOCAL_DEV_URL_RE.test(url)
}

export const LOCAL_DEV_TOOLTIP =
  "Sent from a developer's machine (a local dev server or a phone on the same Wi-Fi), not from the deployed app. It may not happen for real users."

export const ORIGIN_FILTER_OPTIONS = [
  { value: 'deployed', label: 'Deployed app only' },
  { value: 'local', label: 'Local dev only' },
] as const
