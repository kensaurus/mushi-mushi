/**
 * Terminal text stored on a fix attempt (lefthook / husky pre-push output).
 * The report page used to print the bytes as-is, so colour codes showed up
 * as text (`\u001b[38;2;56;56;56m`). Keep the refusal rules in sync with
 * `packages/server/supabase/functions/_shared/humanize-error.ts` and
 * `packages/cli/src/commands/work.ts` (`isHookRejection`).
 */

export interface PushHookAdvice {
  /** Sentence, ends with a period. ≤ 70 chars. */
  title: string
  hint: string
  checks: string[]
  /** Absolute worker checkout, when the stored error names one. */
  checkout: string | null
  /**
   * `git -C <checkout> push …`. Runs from any directory, including the
   * normal repository, while the branch stays checked out in the worktree.
   */
  command: string | null
}

const HOOK_MARK = /hook steps failed:|pre-push hook|\blefthook\b|husky - pre-push|🥊/
/** The push itself failed. A lefthook mention in some other error is not this. */
const PUSH_FAILED = /\bgit push failed\b|\bfailed to push some refs\b/i
/**
 * Check names may contain dots (`test.unit`). The summary sentence ends at
 * the period after the list, not at a period inside a name.
 * Keep in sync with `_shared/humanize-error.ts` and `commands/work.ts`.
 */
const SUMMARY_CHECKS = /hook steps failed:\s*((?:[\w:-]+(?:\.[\w:-]+)*)(?:\s*,\s*(?:[\w:-]+(?:\.[\w:-]+)*))*)/i
const CHECK_NAME = /^[\w:-]+(?:\.[\w:-]+)*$/
const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/
/** Absolute path with no spaces or shell metacharacters, so it can sit in `git -C`. */
const SAFE_ABS = /^\/(?:[\w.@+-]+\/)*[\w.@+-]+$/

/** CSI / OSC sequences, plus the same codes stored as the six characters `\u001b`. */
export function stripTerminalCodes(text: string): string {
  return text
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\\u001b\[[0-9;?]*[ -/]*[@-~]/gi, '')
    .replace(/\\x1b\[[0-9;?]*[ -/]*[@-~]/gi, '')
}

/**
 * Git's own remote-rejection lines. A failing check that prints
 * "permission denied" or "Authentication failed" is not one of these.
 */
export function gitRemoteRejection(text: string): boolean {
  return text.split(/\n|\s\/\s/).some((chunk) => {
    const s = chunk.trim()
    if (/\[[rR]ejected\]|\bnon-fast-forward\b/.test(s)) return true
    if (/(?:^|\s)(?:remote:|fatal:).*(?:Authentication failed|Permission denied)/i.test(s)) return true
    return false
  })
}

/**
 * A push the repo's own hook refused. An explicit `hook steps failed:`
 * summary wins over words a check printed. Remote auth and a rejected
 * update stay remote errors.
 */
export function isPushHookFailure(text: string): boolean {
  const plain = stripTerminalCodes(text)
  if (!PUSH_FAILED.test(plain) || !HOOK_MARK.test(plain)) return false
  if (/hook steps failed:/i.test(plain)) return true
  return !gitRemoteRejection(plain)
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
 * The worker checkout recorded on a refused push (`Worker checkout: /path`).
 * A path with a space does not match: a partial token must not become `git -C`.
 */
export function workerCheckout(text: string): string | null {
  const m = /Worker checkout: (\S+)(?:\s+\||\s*$)/.exec(stripTerminalCodes(text).replace(/[ \t]+/g, ' ').trim())
  return m?.[1] ?? null
}

/**
 * Push that branch from the checkout Mushi kept. Null when the path or the
 * branch is not safe to place in a command.
 */
export function pushRecoveryCommand(checkout: string, branch: string): string | null {
  if (!SAFE_ABS.test(checkout)) return null
  if (!GIT_REF.test(branch) || branch.includes('..') || branch.startsWith('-')) return null
  return `git -C ${checkout} push -u origin ${branch}`
}

function savedBranch(text: string): { branch: string; sha: string } | null {
  const m = /committed on (\S+) \(([0-9a-f]{7,40})\)/i.exec(text)
  if (!m) return null
  return { branch: m[1]!, sha: m[2]! }
}

/**
 * A push the repo's own pre-push hook refused. Null unless the text is an
 * explicit failed push (not a commit hook, and not an unrelated error that
 * merely mentions lefthook). Also null for a remote rejection.
 */
export function pushHookAdvice(text: string): PushHookAdvice | null {
  const plain = stripTerminalCodes(text).replace(/[ \t]+/g, ' ').trim()
  if (!isPushHookFailure(plain)) return null
  const checks = failedHookChecks(plain)
  const checkout = workerCheckout(plain)
  const saved = savedBranch(plain)
  const command = checkout && saved ? pushRecoveryCommand(checkout, saved.branch) : null
  const which = checks.length ? ` Failed checks: ${checks.join(', ')}.` : ''
  const fix = checks.length ? `Fix ${checks.join(', ')}` : 'Fix the failing check'
  const where = saved
    ? `The fix is committed on ${saved.branch} (${saved.sha.slice(0, 7)})`
    : 'The fix is committed on its branch'
  const place = command && checkout
    ? ` in the worker checkout ${checkout}; nothing was pushed.${which} ${fix}, then from any directory run: ${command}.`
    : `; nothing was pushed.${which} ${fix}, then open the worker checkout mushi work kept (the branch is still checked out there) and run git push from that directory.`
  const output = /Hook output: (.*)$/.exec(plain)?.[1]?.trim()
  // Older rows stored the hook log itself. Keep a short plain excerpt so the
  // page still shows which check failed, without the colour codes.
  const detail = output
    ? ` ${output.slice(0, 240)}`
    : ` ${plain.replace(/\s+/g, ' ').slice(0, 240)}`
  return {
    title: "Your repo's own checks failed at push.",
    hint: `${where}${place} Sending the report to your local worker starts another run. A cloud dispatch hits the same checks.${detail}`,
    checks,
    checkout,
    command,
  }
}
