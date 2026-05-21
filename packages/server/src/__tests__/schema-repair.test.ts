/**
 * FILE: schema-repair.test.ts
 *
 * Round 9 regression test for the fix-worker structured-output auto-repair.
 * Sentry MUSHI-MUSHI-SERVER-J + MUSHI-MUSHI-SERVER-8 (regressed 2026-04-23):
 * `AI_NoObjectGeneratedError` fires when the LLM returns text that fails the
 * Zod refinements (placeholder content, truncated rationale, etc.). Previous
 * code had no retry path — first failure → failed dispatch.
 *
 * The Round 9 fix wraps the `generateObject` call in a one-retry loop.
 * These tests verify the retry logic in isolation using pure TypeScript,
 * mirroring the same "extract decision predicate" pattern as
 * `fix-worker-context-gate.test.ts`.
 *
 * NOTE: The production implementation lives in:
 *   packages/server/supabase/functions/fix-worker/index.ts
 * Functions `extractZodIssues` and `buildSchemaRepairHint` are reproduced here
 * in pure form so the test runs without Deno or the `npm:ai@4` specifier.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Pure-form reproductions of the production helpers
// (no Deno deps — safe to run in Vitest/Node)
// ---------------------------------------------------------------------------

type ZodIssueSlim = { path: string; code?: string; message: string }

/** Mirrors `extractZodIssues` in fix-worker/index.ts */
function extractZodIssues(err: { isNoObjectGeneratedError?: boolean; cause?: { issues?: Array<{ path: (string | number)[]; message: string; code?: string }> } }): ZodIssueSlim[] {
  if (!err.isNoObjectGeneratedError) return []
  const issues = err.cause?.issues ?? []
  return issues.slice(0, 5).map((i) => ({
    path: i.path.join('.'),
    code: i.code,
    message: i.message,
  }))
}

/** Mirrors `buildSchemaRepairHint` in fix-worker/index.ts */
function buildSchemaRepairHint(issues: ZodIssueSlim[]): string {
  const issueLines =
    issues.length > 0
      ? issues.map((i) => `  • Field \`${i.path}\`: ${i.message}`).join('\n')
      : '  • Unknown validation failure — ensure all required fields are present and non-empty.'

  return [
    'Your previous response did not satisfy the required JSON schema. Specific failures:',
    issueLines,
    '',
    'Return ONLY the JSON object that fixes all of the above. No prose, no markdown fences.',
    'Required fields: summary (10–120 chars), rationale (20–2000 chars), files (1–10 items each',
    'with path, contents, and reason), needsHumanReview (boolean).',
    'Never use "placeholder", "TODO", "lorem ipsum", "...", or any stub content — Zod will reject them.',
  ].join('\n')
}

/** Mirrors the retry logic in fix-worker/index.ts (simplified, no DB) */
async function withSchemaRepairRetry(
  callLlm: (repairHint?: string) => Promise<{ object: Record<string, unknown> }>,
  maxAttempts = 2,
): Promise<{ object: Record<string, unknown>; repairAttempts: number }> {
  let repairAttempts = 0
  let lastErr: { isNoObjectGeneratedError: boolean; cause?: { issues?: Array<{ path: (string | number)[]; message: string }> }; text?: string } | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const repairHint = attempt > 0 && lastErr
        ? buildSchemaRepairHint(extractZodIssues(lastErr))
        : undefined
      const result = await callLlm(repairHint)
      return { object: result.object, repairAttempts }
    } catch (err) {
      const e = err as { isNoObjectGeneratedError?: boolean; text?: string; cause?: { issues?: Array<{ path: (string | number)[]; message: string }> } }
      if (!e.isNoObjectGeneratedError) throw err
      lastErr = { isNoObjectGeneratedError: true, cause: e.cause, text: e.text }
      repairAttempts = attempt + 1
      if (attempt >= maxAttempts - 1) throw err
    }
  }
  // TypeScript exhaustiveness; unreachable in practice.
  throw lastErr
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_FIX = {
  summary: 'fix(button): prevent rage-click double-submit',
  rationale: 'The button handler did not debounce — a fast double-click submitted twice.',
  files: [{ path: 'src/Button.tsx', contents: 'export function Btn() {}', reason: 'add guard' }],
  needsHumanReview: false,
}

function makeNoObjectError(zodMessages: string[] = ['rationale must explain the root cause']): {
  isNoObjectGeneratedError: boolean
  text: string
  cause: { issues: Array<{ path: (string | number)[]; message: string }> }
} {
  return {
    isNoObjectGeneratedError: true,
    text: '{"summary":"placeholder fix","rationale":"TODO"}',
    cause: {
      issues: zodMessages.map((m, i) => ({ path: [i === 0 ? 'rationale' : 'summary'], message: m })),
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('schema-repair retry logic (MUSHI-MUSHI-SERVER-J/8)', () => {
  it('succeeds on first attempt without any repair — repairAttempts = 0', async () => {
    const mockCallLlm = vi.fn().mockResolvedValueOnce({ object: VALID_FIX })

    const result = await withSchemaRepairRetry(mockCallLlm)

    expect(mockCallLlm).toHaveBeenCalledTimes(1)
    expect(result.repairAttempts).toBe(0)
    expect(result.object).toEqual(VALID_FIX)
  })

  it('retries once on NoObjectGeneratedError and succeeds — repairAttempts = 1', async () => {
    const noObjectErr = makeNoObjectError()
    const mockCallLlm = vi.fn()
      .mockRejectedValueOnce(noObjectErr)
      .mockResolvedValueOnce({ object: VALID_FIX })

    const result = await withSchemaRepairRetry(mockCallLlm)

    expect(mockCallLlm).toHaveBeenCalledTimes(2)
    expect(result.repairAttempts).toBe(1)
    expect(result.object).toEqual(VALID_FIX)
  })

  it('second call receives the schema-repair hint as an argument', async () => {
    const noObjectErr = makeNoObjectError(['rationale must explain the root cause, not a placeholder'])
    const mockCallLlm = vi.fn()
      .mockRejectedValueOnce(noObjectErr)
      .mockResolvedValueOnce({ object: VALID_FIX })

    await withSchemaRepairRetry(mockCallLlm)

    const secondCallArg = mockCallLlm.mock.calls[1]?.[0] as string | undefined
    expect(secondCallArg).toBeDefined()
    expect(secondCallArg).toMatch(/did not satisfy the required JSON schema/)
    expect(secondCallArg).toMatch(/rationale must explain the root cause/)
    expect(secondCallArg).toMatch(/Return ONLY the JSON object/)
  })

  it('exhausts both attempts and re-throws when both fail', async () => {
    const noObjectErr = makeNoObjectError()
    const mockCallLlm = vi.fn()
      .mockRejectedValueOnce(noObjectErr)
      .mockRejectedValueOnce(noObjectErr)

    await expect(withSchemaRepairRetry(mockCallLlm)).rejects.toBe(noObjectErr)
    expect(mockCallLlm).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on non-schema errors (e.g. network, rate-limit)', async () => {
    const networkErr = new Error('fetch failed: ECONNRESET')
    const mockCallLlm = vi.fn().mockRejectedValueOnce(networkErr)

    await expect(withSchemaRepairRetry(mockCallLlm)).rejects.toThrow('fetch failed: ECONNRESET')
    expect(mockCallLlm).toHaveBeenCalledTimes(1)
  })
})

describe('extractZodIssues', () => {
  it('returns an empty array for non-schema errors', () => {
    expect(extractZodIssues({ isNoObjectGeneratedError: false })).toEqual([])
  })

  it('extracts issues from a NoObjectGeneratedError', () => {
    const err = makeNoObjectError(['must be non-empty'])
    const issues = extractZodIssues(err)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toBe('must be non-empty')
  })

  it('caps at 5 issues', () => {
    const messages = Array.from({ length: 8 }, (_, i) => `issue ${i}`)
    const err = makeNoObjectError(messages)
    const issues = extractZodIssues(err)
    expect(issues).toHaveLength(5)
  })
})

describe('buildSchemaRepairHint', () => {
  it('includes the field path and message for each issue', () => {
    const hint = buildSchemaRepairHint([
      { path: 'rationale', message: 'must explain the root cause' },
      { path: 'files.0.contents', message: 'must be real content' },
    ])
    expect(hint).toContain('`rationale`')
    expect(hint).toContain('must explain the root cause')
    expect(hint).toContain('`files.0.contents`')
    expect(hint).toContain('Return ONLY the JSON object')
  })

  it('produces a fallback line when no issues are provided', () => {
    const hint = buildSchemaRepairHint([])
    expect(hint).toContain('Unknown validation failure')
    expect(hint).toContain('Return ONLY the JSON object')
  })
})
