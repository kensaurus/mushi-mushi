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
/** The push itself failed. A lefthook mention in some other error is not this. */
const PUSH_FAILED = /\bgit push failed\b|\bfailed to push some refs\b/i
const NOT_HOOK_PUSH = /non-fast-forward|\[rejected\]|Authentication failed|permission denied/i
/**
 * Check names may contain dots (`test.unit`). The summary sentence ends at
 * the period after the list, not at a period inside a name.
 * Keep in sync with `_shared/humanize-error.ts` and `commands/work.ts`.
 */
const SUMMARY_CHECKS = /hook steps failed:\s*((?:[\w:-]+(?:\.[\w:-]+)*)(?:\s*,\s*(?:[\w:-]+(?:\.[\w:-]+)*))*)/i
const CHECK_NAME = /^[\w:-]+(?:\.[\w:-]+)*$/

/** CSI / OSC sequences, plus the same codes stored as the six characters `\u001b`. */
export function stripTerminalCodes(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\\u001b\[[0-9;?]*[A-Za-z]/gi, '')
    .replace(/\\x1b\[[0-9;?]*[A-Za-z]/gi, '')
}

/** Names lefthook printed as failed steps (`hook steps failed: test.unit, knip` or `🥊 test`). */
export function failedHookChecks(text: string): string[] {
  const plain = stripTerminalCodes(text)
  const named = SUMMARY_CHECKS.exec(plain)?.[1]
  const fromSummary = named
    ? named.split(',').map((s) => s.trim()).filter((s) => CHECK_NAME.test(s))
    : []
  const fromIcons = [...plain.matchAll(/🥊\s+([\w:.-]+)/g)].map((m) => m[1]!.replace(/\.+$/, ''))
  return [...new Set([...fromSummary, ...fromIcons])].filter(Boolean).slice(0, 6)
}

/**
 * A push the repo's own pre-push hook refused. Null unless the text is an
 * explicit failed push (not a commit hook, and not an unrelated error that
 * merely mentions lefthook). Also null for a remote rejection.
 */
export function pushHookAdvice(text: string): PushHookAdvice | null {
  const plain = stripTerminalCodes(text)
  if (NOT_HOOK_PUSH.test(plain) || !PUSH_FAILED.test(plain) || !HOOK_MARK.test(plain)) return null
  const checks = failedHookChecks(plain)
  const which = checks.length ? ` Failed checks: ${checks.join(', ')}.` : ''
  const fix = checks.length ? `Fix ${checks.join(', ')} and push the saved branch` : 'Fix that check and push the saved branch'
  return {
    title: "Your repo's own checks failed at push.",
    hint: `The fix is committed on its branch; nothing was pushed.${which} ${fix}, or send the report to your local worker again. A cloud dispatch hits the same checks.`,
    checks,
  }
}

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/
const SHA = /^[0-9a-f]{7,40}$/i

/**
 * Confirm the saved commit and push that branch from the checkout Mushi kept.
 * Null when the branch is not a plain git ref.
 */
export function pushRecoveryCommand(branch: string, commitSha: string | null): string | null {
  if (!GIT_REF.test(branch) || branch.includes('..')) return null
  const sha = commitSha && SHA.test(commitSha) ? commitSha : null
  const check = sha ? `git rev-parse --verify ${sha} && ` : ''
  return `${check}git checkout ${branch} && git push -u origin ${branch}`
}
