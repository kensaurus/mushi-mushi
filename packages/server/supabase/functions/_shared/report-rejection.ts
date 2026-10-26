/**
 * FILE: packages/server/supabase/functions/_shared/report-rejection.ts
 * PURPOSE: Why a report was rejected, in a form safe to log: field paths and
 *          validation codes only, never a value.
 *
 *          On 2026-10-26 yen-yen's Android app got 400 on every POST
 *          /v1/reports and the access log said nothing more; the cause (the
 *          RN fingerprint digest failing a regex) had dropped every RN report
 *          since June. A rejected report must say which field failed.
 *
 *          Zod messages can repeat the received value (enum, literal), and a
 *          record key inside `metadata` or `tags` is host data that may be an
 *          email, so messages are dropped and any path segment that is not a
 *          plain identifier becomes `*`.
 *
 * Pure: no Deno globals, no npm: specifiers, so vitest imports it directly.
 */

export interface RejectionIssue {
  path: string
  code: string
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/

/** At most `max` issues, each as `a.#.b` (array index `#`) and its zod code. */
export function rejectionIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; code: string }>,
  max = 10,
): RejectionIssue[] {
  return issues.slice(0, max).map((i) => ({
    path: i.path.map((s) => (typeof s === 'number' ? '#' : IDENT.test(s) ? s : '*')).join('.') || '(root)',
    code: IDENT.test(i.code) ? i.code : 'unknown',
  }))
}

/**
 * The counter's reason: the first issue as `path:code`
 * (`fingerprintHash:invalid_string`), at most 200 characters.
 */
export function rejectionReason(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; code: string }>): string {
  const [first] = rejectionIssues(issues, 1)
  return first ? `${first.path}:${first.code}`.slice(0, 200) : '(root):unknown'
}

const SDK_PACKAGE = /^@mushi-mushi\/[a-z0-9][a-z0-9-]{0,60}$/

/** The payload's `sdkPackage` when it is one of ours, else '': host text never lands in the counter. */
export function rejectionSdkPackage(body: unknown): string {
  const raw = (body as { sdkPackage?: unknown } | null)?.sdkPackage
  return typeof raw === 'string' && SDK_PACKAGE.test(raw) ? raw : ''
}
