/**
 * FILE: apps/admin/src/lib/reporterEmailLink.ts
 * PURPOSE: The public page a reporter opens from an update email: confirm the
 *          address (double opt-in) or stop the emails (Plan 018 §4.1).
 *
 * Supabase serves HTML from Edge Functions as text/plain with a sandbox CSP,
 * so the API can not render a clickable page itself. The email links here;
 * the button POSTs the token to the API. Nothing is written until the person
 * clicks — link scanners only load the page.
 */

export type ReporterEmailAction = 'verify' | 'unsubscribe'

export interface ReporterEmailLink {
  action: ReporterEmailAction
  token: string
}

/** The action + token from `?action=…&t=…`, or null when the link is broken. */
export function parseReporterEmailLink(search: string): ReporterEmailLink | null {
  const params = new URLSearchParams(search)
  const action = params.get('action')
  const token = params.get('t') ?? ''
  if (action !== 'verify' && action !== 'unsubscribe') return null
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null
  return { action, token }
}

export const REPORTER_EMAIL_COPY: Record<ReporterEmailAction, { title: string; body: string; button: string }> = {
  verify: {
    title: 'Confirm your email',
    body: 'You asked to get an email when a report you sent has news. Confirm to start getting them.',
    button: 'Confirm',
  },
  unsubscribe: {
    title: 'Stop email updates?',
    body: 'You will stop getting emails about your reports. Updates still show in the app.',
    button: 'Stop emails',
  },
}

export type ReporterEmailOutcome = { ok: true; title: string; message: string } | { ok: false; message: string }

/** POST the token to the API. Never throws. */
export async function submitReporterEmailLink(
  apiBase: string,
  link: ReporterEmailLink,
  fetchImpl: typeof fetch = fetch,
): Promise<ReporterEmailOutcome> {
  try {
    const res = await fetchImpl(`${apiBase}/v1/public/reporter/email/${link.action}?t=${encodeURIComponent(link.token)}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; data?: { title?: string; message?: string }; error?: { message?: string } }
      | null
    if (res.ok && body?.ok) {
      return { ok: true, title: body.data?.title ?? 'Done', message: body.data?.message ?? '' }
    }
    return { ok: false, message: body?.error?.message ?? 'Something went wrong. Please try again in a minute.' }
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' }
  }
}
