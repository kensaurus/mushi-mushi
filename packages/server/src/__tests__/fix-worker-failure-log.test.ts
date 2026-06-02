/**
 * FILE: fix-worker-failure-log.test.ts
 * PURPOSE: Lock the MUSHI-MUSHI-SERVER-8 fix — the fix-worker must NOT emit a
 *          Sentry `error` ("Fix worker failed") for expected PDCA guardrail
 *          outcomes (scope_blocked, validation_rejected, spec_violation,
 *          no_relevant_code, llm_rate_limit). Those are recorded on the
 *          fix_attempt + dispatch row and fanned out via the `fix.failed`
 *          plugin event; re-emitting them as errors paged on-call every time
 *          a guardrail did its job (9 "scope_blocked" events on glot.it).
 *
 *          Genuine infra failures (github_*, sandbox_*, llm_other_error,
 *          context_assembly_failed, unknown) MUST still log at `error` →
 *          Sentry. We mirror the decision predicate here so CI enforces it
 *          without booting Deno + Supabase, plus a source-level snapshot so
 *          the gate can't silently disappear.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mirror of EXPECTED_FAILURE_CATEGORIES in
// supabase/functions/fix-worker/index.ts. Kept in sync by the source-snapshot
// test below.
const EXPECTED_FAILURE_CATEGORIES = new Set<string>([
  'scope_blocked',
  'validation_rejected',
  'spec_violation',
  'no_relevant_code',
  'llm_rate_limit',
]);

type LogLevel = 'warn' | 'error';

/** The decision the catch block makes for a given failure category. */
function failureLogLevel(failureCategory: string): LogLevel {
  return EXPECTED_FAILURE_CATEGORIES.has(failureCategory) ? 'warn' : 'error';
}

const FIX_WORKER_SRC = resolve(
  __dirname,
  '../../supabase/functions/fix-worker/index.ts',
);

describe('fix-worker failure logging (MUSHI-MUSHI-SERVER-8)', () => {
  describe('log-level decision predicate', () => {
    it('logs scope_blocked at warn (not a Sentry error)', () => {
      expect(failureLogLevel('scope_blocked')).toBe('warn');
    });

    it('logs every expected guardrail outcome at warn', () => {
      for (const cat of EXPECTED_FAILURE_CATEGORIES) {
        expect(failureLogLevel(cat)).toBe('warn');
      }
    });

    it.each([
      'github_403',
      'github_404',
      'github_422',
      'github_other_error',
      'sandbox_error',
      'sandbox_timeout',
      'llm_other_error',
      'llm_no_object',
      'llm_invalid_json',
      'context_assembly_failed',
      'unknown',
    ])('logs genuine failure %s at error (escalates to Sentry)', (cat) => {
      expect(failureLogLevel(cat)).toBe('error');
    });
  });

  describe('source snapshot — gate is wired in the edge function', () => {
    const src = readFileSync(FIX_WORKER_SRC, 'utf8');

    it('declares EXPECTED_FAILURE_CATEGORIES with the guardrail outcomes', () => {
      expect(src).toContain('EXPECTED_FAILURE_CATEGORIES');
      for (const cat of EXPECTED_FAILURE_CATEGORIES) {
        expect(src).toContain(`'${cat}'`);
      }
    });

    it('branches the catch-block log level on the expected-category set', () => {
      expect(src).toMatch(
        /EXPECTED_FAILURE_CATEGORIES\.has\(failureCategory\)[\s\S]{0,120}log\.warn\(/,
      );
      // The genuine-failure branch must still page via log.error.
      expect(src).toContain("log.error('Fix worker failed'");
    });
  });
});
