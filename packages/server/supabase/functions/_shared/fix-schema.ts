/**
 * Structured-output schema for the fix-worker Edge Function.
 *
 * Lives in `_shared` (not `fix-worker/index.ts`) so the Node-side regression
 * tests in `packages/server/src/__tests__/` can import the schema and
 * `isPlaceholderContents` without dragging in the `npm:ai@4` Deno specifier
 * that the Edge runtime uses. Vitest can then verify the schema contract
 * before code lands in production.
 */

import { z } from 'npm:zod@3'

/**
 * Sentry MUSHI-MUSHI-SERVER-J / MUSHI-MUSHI-SERVER-8 (regressed 2026-04-23):
 * the fix-worker LLM occasionally emits literal "placeholder" / "TODO" / lorem-
 * ipsum strings for `files[].contents` when context is thin or the model
 * decides to bail. Zod's previous max-length-only constraints accepted them,
 * the worker wrote a placeholder file to a draft PR, the judge disagreed, and
 * the dispatch eventually failed downstream with no actionable trace. The
 * events that finally surfaced as `AI_NoObjectGeneratedError` were the
 * SECOND-pass schema failures after a retry produced contents that no longer
 * met some other constraint.
 *
 * Rejecting these at the schema boundary makes the AI SDK structured-output
 * retry feed the LLM an actionable error message instead of "invalid string"
 * and prevents garbage from ever being written to disk. The matcher is
 * intentionally narrow (whole-string `placeholder` / `todo` / `lorem ipsum`,
 * ignoring case + surrounding whitespace) so legitimate file content that
 * *contains* the word "placeholder" (e.g. an `<input placeholder=…>` JSX
 * attribute) passes through.
 */
const PLACEHOLDER_CONTENTS_PATTERN =
  /^[\s\u200b]*(?:placeholder|todo|tbd|fixme|xxx|lorem ipsum[\s\S]*|\.\.\.|n\/a)[\s\u200b\W]*$/i

export const isPlaceholderContents = (s: string): boolean =>
  PLACEHOLDER_CONTENTS_PATTERN.test(s)

const PLACEHOLDER_REJECTION_MESSAGE =
  'must be the full real source — never the literal string "placeholder", "TODO", "lorem ipsum", "...", or similar. ' +
  'If you do not have enough context to write the real file, set needsHumanReview=true and emit the "Relevant code" snippet you would change instead.'

export const fixSchema = z.object({
  // Single short-form summary that becomes the PR title.
  summary: z
    .string()
    .min(10)
    .max(120)
    .refine((s) => !isPlaceholderContents(s), {
      message: 'summary must be a real PR title, not a placeholder',
    })
    .describe(
      'A short, conventional-commit-friendly title for the PR (e.g. "fix(button): prevent rage-click double-submit"). Must fit GitHub PR title limits. NEVER emit "placeholder", "TODO", or stub text — if you cannot write a real title, set needsHumanReview=true and explain why.',
    ),

  // Long-form rationale — the WHY of the change. Becomes part of the PR body.
  rationale: z
    .string()
    .min(20)
    .max(2000)
    .refine((s) => !isPlaceholderContents(s), {
      message: 'rationale must explain the root cause, not a placeholder',
    })
    .describe(
      'Explain *why* this fix resolves the report — root cause + how the change addresses it. Reviewer-facing, plain English. NEVER emit "placeholder" or stub text.',
    ),

  // Each file is a full-content rewrite (path + new contents). The Edge
  // Function diffs against the existing file to validate scope. We don't
  // accept patch hunks — they're too brittle for an LLM to emit reliably.
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(500)
          .describe(
            'Repo-relative file path (forward-slashed). Must be inside the scope directory or a test file.',
          ),
        contents: z
          .string()
          .min(1)
          .max(50_000)
          .refine((s) => !isPlaceholderContents(s), {
            message: PLACEHOLDER_REJECTION_MESSAGE,
          })
          .describe(
            'Full new file contents. The Edge Function replaces the file atomically — never partial. NEVER emit "placeholder" or stub text — that just creates a broken PR a human has to clean up.',
          ),
        reason: z
          .string()
          .min(5)
          .max(500)
          .refine((s) => !isPlaceholderContents(s), {
            message: 'files[].reason must be the real per-file reason, not a placeholder',
          })
          .describe('One-line per-file reason for the change.'),
      }),
    )
    .min(1)
    .max(10)
    .describe(
      'Files to change. Keep the set minimal — adding test files is encouraged.',
    ),

  needsHumanReview: z
    .boolean()
    .describe(
      'Set true when confidence is low or the fix touches security-sensitive code. Forces draft PR.',
    ),
})

export type FixOutput = z.infer<typeof fixSchema>
