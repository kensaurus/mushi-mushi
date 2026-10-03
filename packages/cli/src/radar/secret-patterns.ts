/**
 * FILE: secret-patterns.ts
 * PURPOSE: The one list of secret shapes Mushi looks for, and a scan that
 *          returns every match with its line. Used by the server's
 *          `scanForSecrets` (text Mushi stores or feeds to an LLM) and by the
 *          CLI's `key_in_client_bundle` scan of built bundles.
 *
 * This file has NO imports and is kept byte-identical in two places:
 *   packages/server/supabase/functions/_shared/secret-patterns.ts
 *   packages/cli/src/radar/secret-patterns.ts
 * (asserted by packages/server/src/__tests__/secret-patterns.test.ts).
 * Edit both together.
 */

/** @public Read by the server's radar ingest schema (the kind of key a CI finding names). */
export const SECRET_LABELS = [
  'private key',
  'Anthropic key',
  'OpenAI-style key',
  'AWS access key id',
  'GitHub token',
  'GitHub fine-grained token',
  'Cursor API key',
  'JWT',
  'database connection string',
  'Slack token',
  'Mushi API key',
  'Stripe live key',
  'Supabase secret key',
] as const
export type SecretLabel = (typeof SECRET_LABELS)[number]

/**
 * In order: the first label that matches is the one `scanForSecrets` reports.
 * @public Read by the server's scanForSecrets.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; label: SecretLabel }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { re: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: 'Anthropic key' },
  // Project, service-account and admin keys (sk-proj-, sk-svcacct-, sk-admin-) and the legacy sk-<48>.
  { re: /sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{20,})/, label: 'OpenAI-style key' },
  { re: /(?:AKIA|ASIA)[0-9A-Z]{16}/, label: 'AWS access key id' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub token' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained token' },
  { re: /crsr_[A-Za-z0-9]{32,}/, label: 'Cursor API key' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT' },
  { re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/, label: 'database connection string' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /\bmushi_[A-Za-z0-9]{24,}/, label: 'Mushi API key' },
  { re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, label: 'Stripe live key' },
  // Supabase's secret API key bypasses RLS like service_role; sb_publishable_ is public by design.
  { re: /\bsb_secret_[A-Za-z0-9_-]{20,}/, label: 'Supabase secret key' },
]

export interface SecretMatch {
  label: SecretLabel
  /** 1-based line of the match. */
  line: number
  /** The matched text. Callers must never send or store it. */
  value: string
}

const WORD = /[A-Za-z0-9_-]/

/**
 * Every secret-shaped match in `text`, at most `max`. Unlike a plain test,
 * a match must not continue a longer word on its left (`task-…` is not an
 * `sk-` key), because minified bundles run identifiers together.
 */
export function findSecrets(text: string, max = 50): SecretMatch[] {
  const out: SecretMatch[] = []
  const lineStarts: number[] = [0]
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1)
  const lineOf = (offset: number): number => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const taken: Array<[number, number]> = []
  for (const { re, label } of SECRET_PATTERNS) {
    const g = new RegExp(re.source, 'g')
    for (const m of text.matchAll(g)) {
      const start = m.index ?? 0
      const end = start + m[0].length
      if (start > 0 && WORD.test(text[start - 1]) && WORD.test(m[0][0])) continue
      // An earlier, more specific pattern already claimed this text (sk-ant- before sk-).
      if (taken.some(([s, e]) => start < e && end > s)) continue
      taken.push([start, end])
      out.push({ label, line: lineOf(start), value: m[0] })
      if (out.length >= max) return out
    }
  }
  return out.sort((a, b) => a.line - b.line)
}
