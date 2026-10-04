/**
 * FILE: apps/admin/src/lib/humanizeApiError.ts
 * PURPOSE: Map API error codes / HTTP failures into plain-English title,
 *          hint, and a recovery action — the page-load counterpart of
 *          humanizeFixError.ts. Used by PageLoadError / ErrorAlert so every
 *          failed GET tells the user what happened and what to do next.
 */

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
      title: 'The server returned an error.',
      hint: 'Retry in a moment. If it keeps failing, quote the code (or status) in a bug report.',
      severity: 'soft',
      action: { label: 'Retry', target: { kind: 'retry' } },
      code: code || undefined,
      raw,
    }
  }

  return {
    title: 'Could not load this page.',
    hint: message || 'Retry in a moment. If it keeps failing, quote the error code when you report a bug.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
    code: code || undefined,
    raw,
  }
}

/** Toast copy for a failed write: a title plus one plain-English next step. */
export interface ApiFailureText {
  title: string
  description: string
}

/**
 * Codes a write can fail with, mapped to what the user can do about it. The
 * server's own message is used instead when it is already a plain sentence
 * (see {@link isPlainSentence}); these cover codes that arrive bare.
 */
const MUTATION_CODE_TEXT: Record<string, string> = {
  FORBIDDEN: 'Only organization owners and admins can change this. Ask one of them to make the change.',
  MISSING_AUTH: 'Your session expired. Sign in again, then retry.',
  INVALID_TOKEN: 'Your session expired. Sign in again, then retry.',
  NETWORK_ERROR: 'Could not reach Mushi. Check your connection and retry.',
  RATE_LIMITED: 'Too many requests. Wait a minute, then retry.',
  QUOTA_EXCEEDED: 'This needs a plan that includes it. Open Billing to upgrade.',
  FEATURE_NOT_IN_PLAN: 'This needs a plan that includes it. Open Billing to upgrade.',
  PLAN_UPGRADE_REQUIRED: 'This needs a plan that includes it. Open Billing to upgrade.',
  NO_PROJECT: 'Pick a project in the project switcher first.',
  PROJECT_NOT_FOUND: 'That project could not be found. Pick another project in the switcher.',
  BAD_KIND: 'This connection cannot be tested from here yet.',
  NO_FIELDS: 'Nothing on this form can be saved. Change a field first.',
  NO_WEBHOOK_CONFIGURED: 'No webhook URL is saved yet. Paste one and click Save, then send a test.',
  INVALID_WEBHOOK_URL: 'That webhook URL is not accepted. Copy it again from the provider.',
  DB_ERROR: 'Something went wrong on our side. Retry in a moment.',
  RPC_ERROR: 'Something went wrong on our side. Retry in a moment.',
  INTERNAL: 'Something went wrong on our side. Retry in a moment.',
  INTERNAL_ERROR: 'Something went wrong on our side. Retry in a moment.',
}

/**
 * True when a server message reads as a sentence a person can act on, not a
 * bare code (`BAD_KIND`), a generic envelope fallback (`Request failed`) or a
 * `column: reason` dump.
 */
export function isPlainSentence(message: string | null | undefined): message is string {
  if (!message) return false
  const m = message.trim()
  if (m.length < 8 || !/\s/.test(m)) return false
  if (/^[A-Z0-9_]+$/.test(m)) return false
  if (/^request failed$/i.test(m)) return false
  // `400: {"error":…}` — apiFetch's raw-body fallback for a non-JSON-envelope failure.
  if (/^\d{3}:/.test(m) || /[{}]/.test(m)) return false
  // `teams_webhook_url: host is not…` — a snake_case field name up front.
  if (/^[a-z]+_[a-z0-9_]+:/.test(m)) return false
  // `webhookUrl must be…`, `pluginName is required` — an API field name up front.
  if (/^[a-z]+(?:_[a-z0-9]+|[A-Z][A-Za-z0-9]*)+\b/.test(m)) return false
  return true
}

/**
 * Plain-English toast text for a failed write. `fallbackTitle` names what
 * failed ("Could not save the Teams webhook"); the description says why and
 * what to do, and never shows a raw error code.
 */
export function describeApiFailure(
  error: { code?: string | null; message?: string | null } | null | undefined,
  fallbackTitle: string,
): ApiFailureText {
  const code = (error?.code ?? '').toUpperCase()
  const message = error?.message ?? null
  if (isPlainSentence(message)) return { title: fallbackTitle, description: message.trim() }
  const mapped = MUTATION_CODE_TEXT[code]
  if (mapped) return { title: fallbackTitle, description: mapped }
  return { title: fallbackTitle, description: 'Retry in a moment. If it keeps failing, reload the page.' }
}
