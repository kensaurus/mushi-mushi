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

export interface HumanizeApiErrorOptions {
  /**
   * What the user was doing, for action errors ("dispatch the fix"). The
   * unknown-code fallback then reads "Could not dispatch the fix." and does
   * not echo the server's message, which for writes can be raw database text.
   */
  action?: string
}

export function humanizeApiError(
  error: string | null | undefined,
  explicitCode?: string | null,
  opts: HumanizeApiErrorOptions = {},
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
    // ── Fix dispatch (POST /v1/admin/fixes/dispatch) ──────────────────────
    case 'AUTOFIX_DISABLED':
      return {
        title: 'Auto-fix is off for this project.',
        hint: 'Turn on Auto-fix in Settings, then dispatch again.',
        severity: 'hard',
        action: { label: 'Turn on Auto-fix', target: { kind: 'route', to: '/settings?tab=autofix' } },
        code,
        raw,
      }
    case 'FEATURE_REQUEST':
      return {
        title: 'This report is a feature request.',
        hint: 'Set its category to the bug type, then dispatch a fix.',
        severity: 'hard',
        code,
        raw,
      }
    case 'ALREADY_DISPATCHED':
      return {
        title: 'A fix is already running for this report.',
        hint: 'Watch it on the Fixes page; it usually opens a draft PR within a few minutes.',
        severity: 'soft',
        action: { label: 'Open Fixes', target: { kind: 'route', to: '/fixes?tab=attempts' } },
        code,
        raw,
      }
    case 'TARGET_REPO_NOT_IN_PROJECT':
      return {
        title: 'That repo is no longer linked to this project.',
        hint: 'Pick another repo, or link it again on the Repo page.',
        severity: 'hard',
        action: { label: 'Open Repo', target: { kind: 'route', to: '/repo' } },
        code,
        raw,
      }
    case 'REPORT_NOT_FOUND':
      return {
        title: 'That report could not be found.',
        hint: 'It may have been deleted, or it belongs to another project. Refresh the page.',
        severity: 'hard',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    // ── Test generation (test-gen-from-report) ─────────────────────────────
    case 'NO_REPO':
    case 'NO_GITHUB_TOKEN':
      return {
        title: 'GitHub is not connected for this project.',
        hint: 'Connect GitHub and pick the repo, then try again.',
        severity: 'hard',
        action: { label: 'Connect GitHub', target: { kind: 'route', to: '/integrations/config', hash: 'platform-card-github' } },
        code,
        raw,
      }
    case 'GITHUB_ERROR':
      return {
        title: 'GitHub refused the request.',
        hint: 'Check that the GitHub connection can write to the repo, then try again.',
        severity: 'hard',
        action: { label: 'Check GitHub', target: { kind: 'route', to: '/integrations/config', hash: 'platform-card-github' } },
        code,
        raw,
      }
    case 'LLM_FAILED':
      return {
        title: 'The model could not finish the job.',
        hint: 'Check your Anthropic or OpenAI key in Settings, then try again.',
        severity: 'soft',
        action: { label: 'Check API keys', target: { kind: 'route', to: '/settings?tab=byok' } },
        code,
        raw,
      }
    case 'PATH_REJECTED':
    case 'SECRET_PATTERN':
      return {
        title: 'A safety check stopped the generated test.',
        hint: 'No PR was opened. Try again; a new attempt writes a different test.',
        severity: 'soft',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    case 'NO_LLM_KEY':
      return {
        title: 'Add an AI key to use this.',
        hint: 'This feature calls an AI model. Add an Anthropic or OpenAI key under Settings → API keys, then retry.',
        severity: 'hard',
        action: { label: 'Open API keys', target: { kind: 'route', to: '/settings?tab=byok' } },
        code,
        raw,
      }
    case 'LLM_ERROR':
      return {
        title: 'The AI model did not answer.',
        hint: 'The model call failed or timed out. Retry in a moment; if it keeps failing, check the key under Settings → API keys.',
        severity: 'soft',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
        raw,
      }
    case 'INDEX_DISABLED':
      return {
        title: 'The codebase is not indexed yet.',
        hint: 'Connect the GitHub repo and turn on indexing, then retry.',
        severity: 'hard',
        action: { label: 'Open Connect', target: { kind: 'route', to: '/connect' } },
        code,
        raw,
      }
    case 'NOT_FOUND':
      return {
        title: 'That item could not be found.',
        hint: 'It may have been deleted or moved to another project. Refresh the page.',
        severity: 'hard',
        action: { label: 'Retry', target: { kind: 'retry' } },
        code,
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
    // Group J (org members, lessons, queue) — kept together to limit merge churn.
    case 'PROJECT_REQUIRED':
      return {
        title: 'Pick a project first.',
        hint: 'Choose a project in the header switcher, then try again.',
        severity: 'hard',
        action: { label: 'Open projects', target: { kind: 'route', to: '/projects' } },
        code,
        raw,
      }
    case 'OWNER_REQUIRED':
      return {
        title: 'Only an owner can do that.',
        hint: 'Ask a team owner to make this change for you.',
        severity: 'hard',
        code,
        raw,
      }
    case 'LAST_OWNER':
      return {
        title: 'A team needs at least one owner.',
        hint: 'Make someone else an owner first, then change this role.',
        severity: 'hard',
        code,
        raw,
      }
    case 'NOT_RETRYABLE':
      return {
        title: 'Only failed jobs can be retried.',
        hint: 'Completed, waiting and running jobs are left alone. Open the failed or dead-letter lane.',
        severity: 'hard',
        code,
        raw,
      }
    default: {
      const extra = EXTRA_CODE_COPY[code]
      if (extra) return { ...extra, code, raw }
      break
    }
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

  if (opts.action) {
    return {
      title: `Could not ${opts.action}.`,
      hint: 'Try again in a moment. If it keeps failing, quote the error code when you report a bug.',
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

/** Codes whose `message` is written for people and can be shown as is. */
const READABLE_MESSAGE_CODES = new Set(['VALIDATION_ERROR', 'VALIDATION_FAILED', 'BAD_REQUEST', 'UNSUPPORTED_KIND', 'CONFLICT', 'ERROR'])

/** Text that leaked from Postgres / PostgREST / a proxy rather than written for a user. */
function looksInternal(message: string): boolean {
  return (
    /^[A-Z][A-Z0-9_]{2,64}$/.test(message) ||
    /duplicate key|violates|constraint|relation "|column "|syntax error|PGRST\d|SQLSTATE|^\d{3}:/i.test(message)
  )
}

/**
 * One plain-English sentence for a failed action (a button, a save, a
 * stream). The page-load counterpart is `humanizeApiError`; this is for
 * toasts and inline errors, where a raw code, `[object Object]` or a
 * Postgres message used to leak through.
 *
 * Known codes use the shared wording. A server message written for people
 * (validation, conflicts) is kept. Anything else falls back to `fallback`.
 */
export function apiErrorMessage(
  error: { code?: string | null; message?: string | null } | string | null | undefined,
  fallback: string,
): string {
  if (!error) return fallback
  const code = (typeof error === 'string' ? '' : error.code ?? '').toUpperCase()
  const message = (typeof error === 'string' ? error : error.message ?? '').trim()
  // A refusal names the rule that applies ("Viewers cannot merge report
  // groups."); the generic team-switch hint would point at the wrong fix.
  if (code === 'FORBIDDEN' && message && message.toUpperCase() !== code && !looksInternal(message)) {
    return message
  }
  if (code && !READABLE_MESSAGE_CODES.has(code)) {
    const known = humanizeApiError(message || code, code)
    if (known && known.title !== 'Could not load this page.') return `${known.title} ${known.hint}`
  }
  if (!message || looksInternal(message)) return fallback
  return message
}

/* ── Extra codes + mutation toasts (console group I, 2026-10-04) ──────────
 * Kept in one block so other tracks can add codes without touching the
 * switch above. `humanizeApiError` consults EXTRA_CODE_COPY in its default
 * branch; `describeApiError` is the toast-sized counterpart for writes. */

type CodeCopy = Pick<HumanizedApiError, 'title' | 'hint' | 'severity' | 'action'>

const EXTRA_CODE_COPY: Record<string, CodeCopy> = {
  REGION_LOCKED: {
    title: 'This project is already pinned to a region.',
    hint: 'Moving data between regions needs an export and restore. Contact support to migrate it.',
    severity: 'hard',
  },
  INVALID_STATE: {
    title: 'This item changed since the page loaded.',
    hint: 'Refresh the page to see its current state, then try the next step again.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
  },
  UPSTREAM_ERROR: {
    title: 'The background job could not finish.',
    hint: 'Retry in a moment. If it keeps failing, check that the project has an LLM key under Settings → AI keys.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
  },
  WORKER_FAILED: {
    title: 'The background job could not finish.',
    hint: 'Retry in a moment. If it keeps failing, check that the project has an LLM key under Settings → AI keys.',
    severity: 'soft',
    action: { label: 'Retry', target: { kind: 'retry' } },
  },
}

/** Codes whose server message is internal (SQL text, stack hints) and must never reach a toast. */
const ALWAYS_HUMANIZE = new Set([
  'DB_ERROR',
  'RPC_ERROR',
  'INTERNAL',
  'INTERNAL_ERROR',
  'NETWORK_ERROR',
  'MISSING_AUTH',
  'INVALID_TOKEN',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'FEATURE_NOT_IN_PLAN',
  'PLAN_UPGRADE_REQUIRED',
  'INVALID_RESPONSE',
])

/**
 * Some proxies still pass a worker's JSON reply as the message
 * (`{"error":"No metric data"}`). Pull the readable sentence out of it.
 */
function sentenceFromJsonBlob(message: string): string | null {
  const m = message.trim()
  if (!m.startsWith('{')) return null
  try {
    const body = JSON.parse(m) as Record<string, unknown>
    const err = body.error
    if (typeof err === 'string') return err
    if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') {
      return (err as Record<string, string>).message
    }
    if (typeof body.message === 'string') return body.message
  } catch {
    // not JSON after all
  }
  return null
}

function looksLikePlainSentence(message: string, code: string): boolean {
  const m = message.trim()
  if (!m) return false
  if (m.toUpperCase() === code) return false
  if (/^[A-Z][A-Z0-9_]{1,64}$/.test(m)) return false // a bare code
  if (/^[[{]/.test(m)) return false // JSON blob
  if (/^\d{3}:/.test(m)) return false // "500: …" status dump
  return true
}

/**
 * Toast-sized, plain-English description of a failed write. `title` is the
 * caller's "Could not …" line; `hint` says why and what to do. Raw codes and
 * JSON never come through: a readable server sentence is kept, anything else
 * is mapped from its code.
 */
export function describeApiError(
  error: { code?: string | null; message?: string | null } | null | undefined,
  title: string,
): { title: string; hint: string } {
  const code = (error?.code ?? '').toUpperCase()
  const parsed = parsePageDataError(error?.message ?? null)
  const rawMessage = parsed?.message ?? ''
  const message = sentenceFromJsonBlob(rawMessage) ?? rawMessage
  const effectiveCode = code || parsed?.code || ''
  if (!ALWAYS_HUMANIZE.has(effectiveCode) && looksLikePlainSentence(message, effectiveCode)) {
    return { title, hint: message }
  }
  const h = humanizeApiError(message || effectiveCode || 'Request failed', effectiveCode || null)
  const known = effectiveCode !== '' && h != null && h.title !== 'Could not load this page.'
  if (known) return { title, hint: `${h.title} ${h.hint}` }
  return { title, hint: 'Something went wrong. Try again in a moment.' }
}
