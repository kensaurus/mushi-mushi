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
  'If you do not have enough context to write the real file, set needsHumanReview=true and explain in the rationale which file you would need to see.'

const filePathSchema = z
  .string()
  .min(1)
  .max(500)
  .describe('Repo-relative file path (forward-slashed). Must be inside the scope directory or a test file.')

const fileReasonSchema = z
  .string()
  .min(5)
  .max(500)
  .refine((s) => !isPlaceholderContents(s), {
    message: 'files[].reason must be the real per-file reason, not a placeholder',
  })
  .describe('One-line per-file reason for the change.')

const EDIT_PLACEHOLDER_MESSAGE =
  'must be real source text copied from (find) or written for (replace) the file — never "placeholder", "TODO", "..." or similar.'

export const fixEditSchema = z
  .object({
    find: z
      .string()
      .min(1)
      .max(20_000)
      .refine((s) => s.trim().length > 0 && !isPlaceholderContents(s), { message: EDIT_PLACEHOLDER_MESSAGE })
      .describe(
        'Exact text copied verbatim from the current file (no line-number gutter). It must occur exactly once in the file; include enough surrounding lines to make it unique.',
      ),
    replace: z
      .string()
      .max(20_000)
      .refine((s) => !isPlaceholderContents(s), { message: EDIT_PLACEHOLDER_MESSAGE })
      .describe('The text that replaces `find`. May be empty to delete it.'),
  })
  .strict()

const editFileSchema = z
  .object({
    path: filePathSchema,
    edits: z
      .array(fixEditSchema)
      .min(1)
      .max(20)
      .describe('Find/replace edits for an EXISTING file you were shown in full, applied in order.'),
    reason: fileReasonSchema,
  })
  .strict()

const newFileSchema = z
  .object({
    path: filePathSchema,
    contents: z
      .string()
      .min(1)
      .max(50_000)
      .refine((s) => !isPlaceholderContents(s), {
        message: PLACEHOLDER_REJECTION_MESSAGE,
      })
      .describe(
        'Full contents of a NEW file that does not exist yet (typically a test). Never use this for an existing file. NEVER emit "placeholder" or stub text.',
      ),
    reason: fileReasonSchema,
  })
  .strict()

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

  // Each entry is EITHER find/replace edits against an existing file the
  // model was shown in full, OR the full contents of a brand-new file. Full
  // replacements of existing files were dropped (2026-10-03): with truncated
  // context the model refused to "invent" the rest of the file, and every
  // dispatch ended in review_failed. The worker applies the edits to the
  // file it fetched from the base branch (_shared/fix-edits.ts); a `find`
  // that does not match exactly once is fed back to the model, never guessed.
  files: z
    .array(z.union([editFileSchema, newFileSchema]))
    .min(1)
    .max(10)
    .describe(
      'Files to change. Keep the set minimal — adding test files is encouraged. An existing file takes `edits`; only a file that does not exist yet takes `contents`.',
    ),

  needsHumanReview: z
    .boolean()
    .describe(
      'Set true when confidence is low or the fix touches security-sensitive code. No PR is opened; the proposal is kept for a human to review.',
    ),
})

export type FixOutput = z.infer<typeof fixSchema>
export type FixFileEntry = FixOutput['files'][number]
export type FixEditFileEntry = z.infer<typeof editFileSchema>

export function isEditEntry(entry: FixFileEntry): entry is FixEditFileEntry {
  return Array.isArray((entry as { edits?: unknown }).edits)
}

/**
 * The output contract the worker owns. Appended to whichever fix system
 * prompt is active: production reads the prompt from `prompt_versions`
 * (stage 'fix', seeded in 20260422110000), which predates edit hunks, so a
 * change to the hardcoded fallback prompt alone would never reach the model.
 */
export const FIX_OUTPUT_CONTRACT = `Output format (enforced by the worker, applies whatever else this prompt says):
- "Relevant code" shows files marked "(full file …)": the complete current contents at the commit the PR branches from, with a line-number gutter ("  12 | ") that is NOT part of the file. Files marked "(preview only …)" or "(excerpt only …)" are partial.
- You have the full file: change only what is needed, via find/replace. For an EXISTING file emit { path, edits: [{ find, replace }], reason }. Each \`find\` is copied verbatim from the file, without the gutter, and must occur exactly once in it; add surrounding lines until it is unique. Edits apply in order.
- Emit { path, contents, reason } ONLY to create a NEW file that does not exist yet (for example a test). Never emit \`contents\` for an existing file.
- Never rewrite a file you were not shown in full, and never write a \`find\` for text you have not seen. If the code you need is only in a preview, or not shown at all, set needsHumanReview=true and name the file and symbol you would need in the rationale.`
