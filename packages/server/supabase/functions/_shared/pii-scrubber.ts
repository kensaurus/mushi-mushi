/**
 * Server-side PII scrubber applied before every LLM invocation.
 *
 * Pattern order matters. The regex engine is greedy-first, so we run the most
 * specific patterns (SSN, CC) before the generic phone pattern — otherwise a
 * phone regex would eat a credit card's dashes.
 *
 * What's redacted:
 *  - SSN (US 9-digit dashed)
 *  - Credit-card PAN (12–18 digits, tolerant of spaces/dashes — Luhn not
 *    enforced because the LLM doesn't need to see the digits either way)
 *  - Email addresses (GDPR personal data)
 *  - Phone numbers (US / international common formats)
 *  - IPv4 addresses (SEC-3: GDPR treats these as personal data; our audit
 *    flagged that the SDK had an opt-in IP scrubber, but the server didn't
 *    mirror it — so raw IPs were reaching Anthropic/OpenAI)
 *  - IPv6 addresses (for completeness; same GDPR rationale)
 *  - Secret tokens (SEC-4: AWS keys, Stripe keys, Slack tokens, JWTs,
 *    GitHub PATs, generic OpenAI/Anthropic keys). The LLM has zero need for
 *    these; leaking them into prompts => Langfuse dashboards => operator
 *    eyes is the classic OWASP LLM02 (insecure output) path.
 *
 * Constraints:
 *  - Must never throw — we wrap scrubbing around critical-path LLM calls.
 *  - Must be cheap; we iterate patterns once per string, not per character.
 *  - Must not redact common code identifiers (timestamps, UUIDs) — each
 *    pattern is anchored with `\b` and tuned to avoid those.
 */
const PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // --- Financial / government ID (run first — most specific) ---
  { regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { regex: /\b(?:\d[ -]*){12,18}\d\b/g, replacement: '[REDACTED_CC]' },

  // --- Secret tokens (SEC-4) ---
  // Recognise by shape/prefix. Order: vendor-prefixed first, then generic.
  // AWS access key ID (AKIA / ASIA)
  { regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replacement: '[REDACTED_AWS_KEY]' },
  // AWS secret access key (40 base64-ish chars) — conservative to avoid false positives.
  // Only match when preceded by "aws_secret" or "secret_access_key" to reduce churn.
  { regex: /(?:aws_secret_access_key|secret_access_key)["'\s:=]+[A-Za-z0-9/+=]{40}\b/gi, replacement: 'aws_secret_access_key=[REDACTED_AWS_SECRET]' },
  // Stripe live / test secret keys
  { regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g, replacement: '[REDACTED_STRIPE_KEY]' },
  // Stripe restricted/publishable (pk) keys — lower severity but still shouldn't leak
  { regex: /\bpk_(?:live|test)_[A-Za-z0-9]{24,}\b/g, replacement: '[REDACTED_STRIPE_PK]' },
  // Slack bot / user / app tokens
  { regex: /\bxox[abpor]-[A-Za-z0-9-]{10,}\b/g, replacement: '[REDACTED_SLACK_TOKEN]' },
  // GitHub personal access tokens (classic + fine-grained)
  { regex: /\bghp_[A-Za-z0-9]{36}\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  { regex: /\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, replacement: '[REDACTED_GITHUB_PAT]' },
  // OpenAI API keys
  { regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED_OPENAI_KEY]' },
  // Anthropic API keys
  { regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, replacement: '[REDACTED_ANTHROPIC_KEY]' },
  // Google API keys
  { regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, replacement: '[REDACTED_GOOGLE_KEY]' },
  // JWTs (header.payload.signature — base64url)
  { regex: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[REDACTED_JWT]' },

  // --- Network / identifiers ---
  // IPv4 — skip the localhost / link-local / RFC1918 ranges? We don't, because
  // even a private IP is PII under GDPR when combined with other data, and the
  // LLM never needs it. Excludes dotted versions (1.2.3.4.5 won't match due to \b).
  { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '[REDACTED_IP]' },
  // IPv6 (compressed and full) — conservative; requires at least one colon-group.
  { regex: /\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{0,4}\b/g, replacement: '[REDACTED_IPV6]' },

  // --- Contact info ---
  { regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g, replacement: '[REDACTED_EMAIL]' },
  // Phone: tolerant of (415) 555-1212, +1 415-555-1212, 415.555.1212
  { regex: /(?:\+\d{1,3}[\s.-])?\(?\d{2,4}\)?[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g, replacement: '[REDACTED_PHONE]' },
]

export function scrubPii(text: string): string {
  if (!text) return text
  let result = text
  for (const { regex, replacement } of PATTERNS) {
    // Clone the regex per call — shared `lastIndex` state on /g regexes would
    // corrupt subsequent runs if this function ever ran concurrently within
    // the same isolate.
    result = result.replace(new RegExp(regex.source, regex.flags), replacement)
  }
  return result
}

export function scrubReport(report: Record<string, any>): Record<string, any> {
  const r = { ...report }
  if (typeof r.description === 'string') r.description = scrubPii(r.description)
  if (typeof r.user_intent === 'string') r.user_intent = scrubPii(r.user_intent)

  if (Array.isArray(r.console_logs)) {
    r.console_logs = r.console_logs.map((log: any) => ({
      ...log,
      message: typeof log.message === 'string' ? scrubPii(log.message) : log.message,
    }))
  }

  if (Array.isArray(r.network_logs)) {
    r.network_logs = r.network_logs.map((log: any) => {
      if (typeof log.url !== 'string') return log
      try {
        const url = new URL(log.url)
        url.searchParams.forEach((_val: string, key: string) => {
          url.searchParams.set(key, scrubPii(url.searchParams.get(key)!))
        })
        // Hosts sometimes contain raw IPs ("http://10.0.0.5/api") — scrub.
        const rebuilt = scrubPii(url.toString())
        return { ...log, url: rebuilt }
      } catch {
        return log
      }
    })
  }

  return r
}
