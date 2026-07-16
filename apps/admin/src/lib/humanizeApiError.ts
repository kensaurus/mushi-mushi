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
