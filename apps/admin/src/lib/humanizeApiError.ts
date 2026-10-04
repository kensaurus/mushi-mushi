/**
 * FILE: apps/admin/src/lib/humanizeApiError.ts
 * PURPOSE: Map API error codes / HTTP failures into plain-English title,
 *          hint, and a recovery action — the page-load counterpart of
 *          humanizeFixError.ts. Used by PageLoadError / ErrorAlert so every
 *          failed GET tells the user what happened and what to do next.
 */

import { describeErrorDetail } from './apiEnvelope'

export interface HumanizedApiError {
  /** ≤ 70 chars, sentence case. */
  title: string
  /** 1–2 sentences, friendly next step. */
  hint: string
  /** soft = retry might work; hard = user must change something. */
  severity: 'soft' | 'hard'
  action?: {
    label: string
    target:
      | { kind: 'route'; to: string; hash?: string }
      | { kind: 'retry' }
      | { kind: 'external'; url: string }
  }
  code?: string
  raw: string
}

const GENERIC_LOAD_TITLE = 'Could not load this page.'
const GENERIC_SERVER_TITLE = 'The server returned an error.'

/**
 * Plain-English copy for slugs that action routes (rewards, tester portal,
 * anti-gaming) return as the whole error — often `{ error: 'region_not_supported' }`,
 * which coerces to `code: 'ERROR'` with the slug as the message. Keys are
 * lower case; lookups are case-insensitive.
 */
const ACTION_ERROR_COPY: Record<string, string> = {
  region_not_supported: "Mushi Bounties isn't available in your country yet, so this can't go ahead.",
  reputation_too_low: 'Your tester reputation is below what this app asks for. Get a few reports accepted on other apps first.',
  kyc_unavailable: 'Tax details can’t be submitted right now. Nothing was saved — try again later.',
  kyc_required: 'Verify your tax details in Settings before redeeming gift cards.',
  withheld_redemption_not_found: 'That redemption was already handled, so nothing changed. Refresh to see where it stands.',
  invalid_webhook: 'Check the webhook: the URL must start with https:// and a custom secret must be at least 16 characters.',
  invalid_quest: 'Check the quest: it needs a name and at least one step with an action and a label.',
  not_a_tester: 'Activate your tester profile first.',
  app_not_found: 'That app is no longer listed. Refresh the list.',
  slug_taken: 'That listing name is already used by another app. Pick a different one.',
  handle_taken: 'That handle is taken. Pick a different one.',
  budget_exceeded: 'This app has used its monthly payout budget. Try again next month or pick Pro credit.',
  forbidden: 'You don’t have access to this.',
  submission_not_found: 'That submission no longer exists. Refresh the list.',
}

const OPAQUE_CODES = new Set(['DB_ERROR', 'RPC_ERROR', 'INTERNAL', 'INTERNAL_ERROR', 'NETWORK_ERROR'])

function looksLikeSlug(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(value) && value.includes('_')
}

/**
 * One sentence for a toast after a failed action (save, join, approve…).
 * Takes the `{ code, message }` an `apiFetch` result carries, maps known
 * slugs to plain English, keeps a readable server sentence, and never
 * returns a raw code, raw JSON or "[object Object]".
 */
export function plainApiError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  fallback: string,
): string {
  const code = error?.code?.trim() ?? ''
  const message = error?.message?.trim() ?? ''

  // Raw database / runtime text is not for users; these codes have copy.
  if (OPAQUE_CODES.has(code.toUpperCase())) {
    const h = humanizeApiError(message || code, code)
    if (h) return `${h.title} ${h.hint}`
  }

  // A sentence the server wrote for people wins over generic copy.
  const http = message.match(/^\d{3}:\s*([\s\S]*)$/)
  const sentence =
    !http &&
    /\s/.test(message) &&
    !message.includes('[object Object]') &&
    !/^[{[]/.test(message)
  if (sentence) return message

  const slug = code && code !== 'ERROR' && code !== 'HTTP_ERROR' ? code : ''
  const mapped =
    (slug ? ACTION_ERROR_COPY[slug.toLowerCase()] : undefined) ??
    (looksLikeSlug(message) ? ACTION_ERROR_COPY[message.toLowerCase()] : undefined) ??
    (message && !/\s/.test(message) ? ACTION_ERROR_COPY[message.toLowerCase()] : undefined)
  if (mapped) return mapped

  // "400: {json}" from a non-envelope response — read the JSON if we can.
  if (http) {
    try {
      const parsed = JSON.parse(http[1]!) as { error?: unknown; message?: unknown }
      const inner = describeErrorDetail(parsed.error) ?? describeErrorDetail(parsed.message)
      if (inner) {
        const innerMapped = ACTION_ERROR_COPY[inner.toLowerCase()]
        if (innerMapped) return innerMapped
        if (!looksLikeSlug(inner)) return inner
      }
    } catch {
      // Truncated or non-JSON body — fall through to the code-based copy.
    }
  }

  const known = humanizeApiError(message || code || 'error', code || null)
  if (known && known.title !== GENERIC_LOAD_TITLE && known.title !== GENERIC_SERVER_TITLE) {
    return `${known.title} ${known.hint}`
  }
  return fallback
}

/**
 * Parse the `message (CODE)` string that usePageData produces, or accept
 * an explicit code + message pair.
 */
export function parsePageDataError(
  error: string | null | undefined,
): { message: string; code?: string } | null {
  if (!error) return null
  const m = error.match(/^(.*)\s+\(([A-Z][A-Z0-9_]{1,64})\)$/)
  if (m) return { message: m[1]!.trim(), code: m[2] }
  return { message: error }
}

export function humanizeApiError(
  error: string | null | undefined,
  explicitCode?: string | null,
): HumanizedApiError | null {
  const parsed = parsePageDataError(error)
  if (!parsed) return null
  const code = (explicitCode ?? parsed.code ?? '').toUpperCase()
  const raw = error ?? parsed.message
  const message = parsed.message

  switch (code) {
    case 'NO_ORG':
    case 'ORG_REQUIRED':
    case 'NO_ORGANIZATION':
      return {
        title: 'No team selected.',
        hint: 'Pick a team in the org switcher (top bar), or create one if you have not joined a team yet.',
        severity: 'hard',
        action: { label: 'Open teams', target: { kind: 'route', to: '/settings?tab=general' } },
        code,
        raw,
      }
    case 'FORBIDDEN':
      return {
        title: 'You do not have access to this.',
        hint: 'Switch to a team you belong to, or ask an owner to invite you.',
        severity: 'hard',
        action: { label: 'Switch team', target: { kind: 'route', to: '/settings?tab=general' } },
        code,
        raw,
      }
    case 'MISSING_AUTH':
    case 'INVALID_TOKEN':
      return {
        title: 'Your session expired.',
        hint: 'Sign in again to continue. Your work is saved on the server.',
        severity: 'hard',
        action: { label: 'Sign in', target: { kind: 'route', to: '/login' } },
        code,
        raw,
      }
    case 'PROJECT_NOT_FOUND':
    case 'NO_PROJECT':
      return {
        title: 'That project could not be found.',
        hint: 'It may have been deleted, or you are looking at the wrong team. Pick another project from the switcher.',
        severity: 'hard',
        action: { label: 'Open projects', target: { kind: 'route', to: '/projects' } },
        code,
        raw,
      }
    case 'VALIDATION_ERROR':
    case 'BAD_REQUEST':
    case 'BAD_JSON':
    case 'INVALID_BODY':
      return {
        title: 'The request did not match what the API expects.',
        hint: 'This is usually a console / API version mismatch. Refresh the page; if it keeps happening, report it with the code below.',
        severity: 'hard',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    case 'RATE_LIMITED':
      return {
        title: 'Too many requests — slow down for a moment.',
        hint: 'Wait about a minute, then retry. If you are scripting against the API, add backoff.',
        severity: 'soft',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    case 'QUOTA_EXCEEDED':
    case 'FEATURE_NOT_IN_PLAN':
    case 'PLAN_UPGRADE_REQUIRED':
      return {
        title: 'This feature is not available on your current plan.',
        hint: 'Upgrade the project plan, or pick a different project that already has access.',
        severity: 'hard',
        action: { label: 'Open billing', target: { kind: 'route', to: '/billing' } },
        code,
        raw,
      }
    case 'NETWORK_ERROR':
      return {
        title: 'Could not reach the Mushi API.',
        hint: 'Check your network connection. If you are online, the API may be briefly down — retry in a moment.',
        severity: 'soft',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    case 'DB_ERROR':
    case 'RPC_ERROR':
    case 'INTERNAL':
    case 'INTERNAL_ERROR':
      return {
        title: 'Something went wrong on our side.',
        hint: 'The failure was logged. Retry in a moment; if it keeps failing, quote the error code when you report a bug.',
        severity: 'soft',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code: code || undefined,
        raw,
      }
    case 'SECRET_DETECTED':
      return {
        title: 'That text looks like it contains a secret.',
        hint: 'Remove API keys, tokens, or connection strings before saving. Rotate anything you already pasted.',
        severity: 'hard',
        code,
        raw,
      }
    default:
      break
  }

  // HTTP status patterns embedded in message (fallback when code missing)
  if (/^5\d\d:/.test(message) || /HTTP_ERROR/.test(code)) {
    return {
      title: GENERIC_SERVER_TITLE,
      hint: 'Retry in a moment. If it keeps failing, quote the code (or status) in a bug report.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      code: code || undefined,
      raw,
    }
  }

  return {
    title: GENERIC_LOAD_TITLE,
    hint: message || 'Retry in a moment. If it keeps failing, quote the error code when you report a bug.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
    code: code || undefined,
    raw,
  }
}
