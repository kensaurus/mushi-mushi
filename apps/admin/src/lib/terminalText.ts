/**
 * Terminal text stored on a fix attempt (lefthook / husky pre-push output).
 * The report page used to print the bytes as-is, so colour codes showed up
 * as text (`\u001b[38;2;56;56;56m`). Keep in sync with the copy in
 * `packages/server/supabase/functions/_shared/humanize-error.ts`.
 */

export interface PushHookAdvice {
  /** Sentence, ends with a period. ≤ 70 chars. */
  title: string
  hint: string
  checks: string[]
}

const HOOK_MARK = /hook steps failed:|pre-push hook|\blefthook\b|husky - pre-push|🥊/

/** CSI / OSC sequences, plus the same codes stored as the six characters `\u001b`. */
export function stripTerminalCodes(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\\u001b\[[0-9;?]*[A-Za-z]/gi, '')
    .replace(/\\x1b\[[0-9;?]*[A-Za-z]/gi, '')
}

/** Names lefthook printed as failed steps (`hook steps failed: test, knip` or `🥊 test`). */
export function failedHookChecks(text: string): string[] {
  const plain = stripTerminalCodes(text)
  const named = /hook steps failed:\s*([^.\n]+)/i.exec(plain)?.[1]
  const fromSummary = named
    ? named.split(',').map((s) => s.trim()).filter((s) => /^[\w:.-]+$/.test(s))
    : []
  const fromIcons = [...plain.matchAll(/🥊\s+([\w:.-]+)/g)].map((m) => m[1]!)
  return [...new Set([...fromSummary, ...fromIcons])].slice(0, 6)
}

/**
 * A push the repo's own pre-push hook refused. Null for a remote rejection
 * or any other error (those must not be rewritten into this sentence).
 */
export function pushHookAdvice(text: string): PushHookAdvice | null {
  const plain = stripTerminalCodes(text)
  if (!HOOK_MARK.test(plain)) return null
  const checks = failedHookChecks(plain)
  const which = checks.length ? ` Failed checks: ${checks.join(', ')}.` : ''
  return {
    title: "Your repo's own checks failed at push.",
    hint: `The fix is committed on its branch; nothing was pushed.${which} Fix that check and push the branch, or send the report to your local worker again. A cloud dispatch hits the same checks.`,
    checks,
  }
}
