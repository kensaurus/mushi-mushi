/**
 * FILE: _shared/secret-scan.ts
 * PURPOSE: Reject operator-authored text that contains a credential before it
 *          is stored and shown to end users or fed to an LLM (the SDK
 *          assistant's knowledge corpus, reporter message templates).
 *          Patterns: API keys, private keys, connection strings, JWTs, Slack
 *          and GitHub tokens. Pure, no I/O.
 */

const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
  { re: /sk-[a-zA-Z0-9]{20,}/, label: 'OpenAI-style key' },
  { re: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: 'Anthropic key' },
  { re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key id' },
  { re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub token' },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, label: 'JWT' },
  { re: /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/, label: 'database connection string' },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/, label: 'Slack token' },
]

/** The kind of secret found (e.g. "JWT"), or null. */
export function scanForSecrets(text: string): string | null {
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(text)) return label
  }
  return null
}
