/**
 * FILE: packages/server/supabase/functions/_shared/secret-scan.ts
 * PURPOSE: One secret-pattern scan for untrusted repo text that Mushi stores
 *          or feeds to an LLM (mushi.recipe.json, DTCG token files). The set
 *          is the union of the sdk-assistant and skill-sync guards; those two
 *          callers still carry their own copies (Plan 019 lists the
 *          extraction as a follow-up so their behaviour does not change here).
 */

const SECRET_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { re: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: 'Anthropic key' },
  { re: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI-style key' },
  { re: /(?:AKIA|ASIA)[0-9A-Z]{16}/, label: 'AWS access key id' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub token' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained token' },
  { re: /crsr_[A-Za-z0-9]{32,}/, label: 'Cursor API key' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT' },
  { re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/, label: 'database connection string' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
  { re: /\bmushi_[A-Za-z0-9]{24,}/, label: 'Mushi API key' },
  { re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/, label: 'Stripe live key' },
]

/** Returns the label of the first secret-shaped match, or null. */
export function scanForSecrets(text: string): string | null {
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) return label
  }
  return null
}
