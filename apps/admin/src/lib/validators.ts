/**
 * FILE: apps/admin/src/lib/validators.ts
 * PURPOSE: Reusable, framework-free validators for admin form inputs.
 *
 *          Every validator takes a string and returns either:
 *            - `null`         → input is valid (or empty + optional)
 *            - `{ message }`  → human-readable error to render under the field
 *            - `{ message, severity: 'warn' }` → soft warning, doesn't block
 *                                                save but flags potential
 *                                                misconfiguration
 *
 *          Validators are intentionally pure functions of the string and a
 *          small options bag — no DOM, no React, no fetch. That makes them
 *          unit-testable in isolation AND callable from outside React (e.g.
 *          from a Save handler that wants to short-circuit a bad payload
 *          before hitting the API).
 *
 *          Naming convention: each validator is grounded in the BACKEND's
 *          actual expectation. We don't invent rules — every rule here
 *          mirrors something the corresponding edge function or the
 *          downstream third-party (Slack, Discord, Sentry, Stripe) will
 *          reject. The goal is "fail fast in the form" not "fail twice".
 *
 *          New validators MUST stay free of dependencies on this app's
 *          state, hooks, or env so they can be reused by:
 *            - the existing form primitives in `components/ui.tsx`
 *            - any one-off panel that wants to gate a Save button
 *            - the unit-test file at `validators.test.ts`
 */

export type ValidationSeverity = 'error' | 'warn'

export interface ValidationResult {
  message: string
  /** 'error' renders red and (when wired) blocks Save. 'warn' renders amber
   *  and is informational only — useful for "this looks like a *test* DSN,
   *  did you mean to use prod?" hints. */
  severity?: ValidationSeverity
}

export type Validator = (value: string) => ValidationResult | null

interface ValidatorOptions {
  /** When true, an empty string is treated as valid (returns `null`). When
   *  false, an empty string returns a "required" error. Defaults to true —
   *  most admin fields are optional and have a sensible backend default. */
  optional?: boolean
}

/* ── Generic helpers ──────────────────────────────────────────────────── */

/** Wraps a validator so empty values short-circuit to valid (the default)
 *  or to a "required" error. */
function withOptional(opts: ValidatorOptions | undefined, body: Validator): Validator {
  const optional = opts?.optional ?? true
  return (value: string) => {
    const trimmed = value.trim()
    if (trimmed === '') {
      if (optional) return null
      return { message: 'Required' }
    }
    return body(trimmed)
  }
}

/** Compose multiple validators — first non-null result wins. Lets call
 *  sites combine "is a URL" + "uses https" + "starts with hooks.slack.com"
 *  without repeating the URL parse three times. */
export function compose(...validators: Validator[]): Validator {
  return (value: string) => {
    for (const v of validators) {
      const result = v(value)
      if (result) return result
    }
    return null
  }
}

/* ── URL family ───────────────────────────────────────────────────────── */

/**
 * Generic absolute URL validator. Accepts `http:` and `https:`. Returns a
 * specific error for the most common typos so users don't have to guess.
 */
export function url(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      // Most common case: user typed `hooks.slack.com/...` with no scheme.
      // The native parse error is "Invalid URL" which isn't actionable, so
      // we surface the missing scheme as the actual hint.
      if (!/^https?:\/\//i.test(value)) {
        return { message: 'Must start with https:// (or http://)' }
      }
      return { message: 'Not a valid URL' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { message: `Unsupported protocol "${parsed.protocol.replace(':', '')}" — use http(s)` }
    }
    return null
  })
}

/** Same as `url()` but rejects http://. Use for any field that ends up in a
 *  webhook POST or in a browser's fetch() call — Mixed Content blocks the
 *  request and customer reports come back as "the integration silently
 *  stopped working". */
export function httpsUrl(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      if (!/^https?:\/\//i.test(value)) {
        return { message: 'Must start with https://' }
      }
      return { message: 'Not a valid URL' }
    }
    if (parsed.protocol === 'http:') {
      return { message: 'Must use https:// (http will be blocked)' }
    }
    if (parsed.protocol !== 'https:') {
      return { message: `Unsupported protocol "${parsed.protocol.replace(':', '')}" — use https` }
    }
    return null
  })
}

/**
 * Slack incoming-webhook URL — the exact shape Slack's "Incoming Webhooks"
 * app issues. Format: `https://hooks.slack.com/services/T.../B.../...`.
 *
 * The check is host-only (not the path) because Slack also supports
 * `https://hooks.slack.com/triggers/...` for Workflow Builder, and we don't
 * want to false-positive on those.
 */
export function slackWebhookUrl(opts?: ValidatorOptions): Validator {
  return compose(
    httpsUrl(opts),
    withOptional({ optional: true }, (value) => {
      try {
        const u = new URL(value)
        if (u.host !== 'hooks.slack.com') {
          return {
            message: `Slack webhooks live on hooks.slack.com (got ${u.host})`,
            severity: 'warn',
          }
        }
      } catch {
        // already caught by httpsUrl
      }
      return null
    }),
  )
}

/**
 * Discord webhook URL. Discord issues two equivalent hosts:
 *   - https://discord.com/api/webhooks/<id>/<token>
 *   - https://discordapp.com/api/webhooks/<id>/<token>
 * Either is accepted. We require the `/api/webhooks/` prefix because that's
 * the only path Discord's webhook handler responds on.
 */
export function discordWebhookUrl(opts?: ValidatorOptions): Validator {
  return compose(
    httpsUrl(opts),
    withOptional({ optional: true }, (value) => {
      try {
        const u = new URL(value)
        const isDiscordHost = u.host === 'discord.com' || u.host === 'discordapp.com' || u.host === 'ptb.discord.com' || u.host === 'canary.discord.com'
        if (!isDiscordHost) {
          return {
            message: `Discord webhooks live on discord.com (got ${u.host})`,
            severity: 'warn',
          }
        }
        if (!u.pathname.startsWith('/api/webhooks/')) {
          return { message: 'URL must contain /api/webhooks/<id>/<token>' }
        }
      } catch {
        // already caught by httpsUrl
      }
      return null
    }),
  )
}

/**
 * Sentry DSN. The format is documented at
 * https://docs.sentry.io/concepts/key-terms/dsn-explainer/
 * and is `https://<public_key>@<org>.ingest.<region>.sentry.io/<project_id>`.
 * We check for the public-key `@host/path` shape rather than hard-coding
 * `sentry.io` — self-hosted Sentry instances live on arbitrary hostnames.
 */
export function sentryDsn(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      return { message: 'Not a valid DSN — expected https://<key>@host/<project_id>' }
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { message: 'DSN must use http(s)://' }
    }
    if (!parsed.username) {
      return { message: 'Missing public key — DSN format is https://<key>@host/<id>' }
    }
    // Project id is the trailing path segment, must be a positive integer.
    const projectId = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '')
    if (!/^\d+$/.test(projectId)) {
      return { message: 'DSN must end with a numeric project id (e.g. /4511023875)' }
    }
    return null
  })
}

/* ── Email + secrets ──────────────────────────────────────────────────── */

/**
 * Email per the WHATWG-aligned regex. We deliberately avoid full RFC 5322
 * because (a) the strict grammar accepts addresses no SMTP server actually
 * delivers to, and (b) the WHATWG form-validation regex is the same one
 * the browser would apply to `<input type=email>` if we set it.
 */
export function email(opts?: ValidatorOptions): Validator {
  const RE =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
  return withOptional(opts, (value) => {
    if (!RE.test(value)) {
      return { message: 'Not a valid email address' }
    }
    return null
  })
}

/**
 * Generic secret/token validator. Checks minimum length and (optionally) a
 * required prefix. Useful for `mushi_*` API keys, Sentry `sntrys_*` tokens,
 * Stripe `sk_*` secrets, etc.
 *
 * Does NOT attempt to detect leaked-secret formats — that's the job of the
 * pre-commit `check-no-secrets.mjs` guard.
 */
export function token({
  prefix,
  minLength = 16,
  optional = true,
}: { prefix?: string; minLength?: number; optional?: boolean } = {}): Validator {
  return withOptional({ optional }, (value) => {
    if (prefix && !value.startsWith(prefix)) {
      return { message: `Expected to start with "${prefix}"` }
    }
    if (value.length < minLength) {
      return { message: `Looks too short (expected ≥ ${minLength} chars)` }
    }
    if (/\s/.test(value)) {
      return { message: 'Tokens cannot contain whitespace — likely a copy-paste artefact' }
    }
    return null
  })
}

/* ── Numbers ──────────────────────────────────────────────────────────── */

interface NumberRangeOptions extends ValidatorOptions {
  min?: number
  max?: number
  /** When set, allow only multiples of this value (e.g. 0.01 for percentages
   *  expressed to two decimals). */
  step?: number
  /** Human label for the unit, e.g. "%", "ms", "tokens" — appears in errors. */
  unit?: string
}

/**
 * Numeric-string validator. Accepts the value as a string (matching the
 * shape of `<input type=text>` controlled state) so we can distinguish
 * "user is mid-typing `0.` " from "user blurred with an empty value".
 */
export function numberInRange({ min, max, step, unit, optional }: NumberRangeOptions = {}): Validator {
  return withOptional({ optional }, (value) => {
    const n = Number(value)
    if (!Number.isFinite(n)) {
      return { message: 'Must be a number' }
    }
    if (min !== undefined && n < min) {
      return { message: `Must be ≥ ${min}${unit ? ` ${unit}` : ''}` }
    }
    if (max !== undefined && n > max) {
      return { message: `Must be ≤ ${max}${unit ? ` ${unit}` : ''}` }
    }
    if (step !== undefined && step > 0) {
      // Float-tolerant modulo — `0.1 % 0.01` famously returns `0.00999…`.
      const ratio = n / step
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        return { message: `Must be a multiple of ${step}` }
      }
    }
    return null
  })
}

/* ── Identifier slugs ─────────────────────────────────────────────────── */

/**
 * Slug validator for org/project slugs (Sentry, GitHub, Linear, etc).
 * Rules mirror what those platforms accept in URL path segments:
 *   - lowercase letters, digits, hyphens
 *   - 1-100 chars
 *   - cannot start or end with a hyphen
 *
 * GitHub specifically also allows underscores and dots in repo names; that
 * relaxation is handled separately so this slug validator stays strict
 * enough for the platforms (Sentry, Linear teams) that genuinely require it.
 */
export function slug(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,98}[a-zA-Z0-9_])?$/.test(value)) {
      return {
        message: 'Letters, digits, hyphens, dots, or underscores only (no spaces, no leading/trailing dot or hyphen)',
      }
    }
    return null
  })
}

/* ── Platform-specific composites ─────────────────────────────────────── */

/**
 * Jira project key. Atlassian's documented format: 2-10 uppercase letters,
 * optionally followed by digits, must START with a letter. (e.g. `BUG`,
 * `WEBSITE2`). Lowercase is rejected — Jira's API normalises everything to
 * uppercase, but the UI surfaces lowercase as a "key not found" error.
 */
export function jiraProjectKey(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(value)) {
      return {
        message: 'Jira project keys are 2-10 uppercase letters/digits, starting with a letter (e.g. BUG, WEB2)',
      }
    }
    return null
  })
}

/**
 * PagerDuty Events API v2 integration key. Documented as a 32-character
 * alphanumeric string. We don't error on length mismatch (PagerDuty has
 * occasionally issued 24- and 32-char keys) but we DO require alphanumeric
 * + reject whitespace, which catches the most common copy-paste mistakes.
 */
export function pagerdutyRoutingKey(opts?: ValidatorOptions): Validator {
  return withOptional(opts, (value) => {
    if (!/^[a-zA-Z0-9]{20,40}$/.test(value)) {
      return {
        message: 'Expected a 20-40 character alphanumeric integration key',
      }
    }
    return null
  })
}

/**
 * GitHub HTTPS repo URL of the form `https://github.com/<owner>/<repo>`.
 * SSH URLs (`git@github.com:owner/repo.git`) are normalised server-side, so
 * the form layer here only validates the HTTPS shape — anything else will
 * surface as a server-side error after Save (which is fine; we don't want
 * to false-negative on the SSH variant some users still copy from GitHub).
 */
export function githubRepoUrl(opts?: ValidatorOptions): Validator {
  return compose(
    httpsUrl(opts),
    withOptional({ optional: true }, (value) => {
      try {
        const u = new URL(value)
        if (u.host !== 'github.com' && u.host !== 'www.github.com') {
          return {
            message: `Expected github.com (got ${u.host})`,
            severity: 'warn',
          }
        }
        // Path must be /<owner>/<repo>[.git] — at least two non-empty segments.
        const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean)
        if (parts.length < 2) {
          return { message: 'URL must include owner and repo, e.g. github.com/owner/repo' }
        }
      } catch {
        // already caught by httpsUrl
      }
      return null
    }),
  )
}

/* ── Named-validator registry ─────────────────────────────────────────── */

/**
 * Resolves a string id (`'httpsUrl'`, `'sentryDsn'`, …) to an actual
 * validator function. Used by integration cards whose field defs are pure
 * data — they can't carry function references because we'd lose the
 * declarative round-tripping (snapshot tests, future "publish to docs"
 * pipelines, etc).
 *
 * Adding a new id requires three coordinated changes:
 *   1. Export the validator function in this file.
 *   2. Add the id to `FieldValidatorName` in `components/integrations/types.ts`.
 *   3. Map id → factory below.
 *
 * Returning `undefined` for an unknown id is a deliberate safety valve:
 * the field renders without validation rather than crashing if the type
 * union ever drifts ahead of the registry.
 */
const NAMED_VALIDATORS: Record<string, Validator> = {
  url: url(),
  httpsUrl: httpsUrl(),
  email: email(),
  sentryDsn: sentryDsn(),
  slug: slug(),
  token: token({ minLength: 16 }),
  tokenLong: token({ minLength: 24 }),
  jiraProjectKey: jiraProjectKey(),
  githubRepoUrl: githubRepoUrl(),
  pagerdutyRoutingKey: pagerdutyRoutingKey(),
}

export function resolveValidator(name?: string): Validator | undefined {
  if (!name) return undefined
  return NAMED_VALIDATORS[name]
}
