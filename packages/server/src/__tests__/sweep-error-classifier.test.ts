/**
 * FILE: packages/server/src/__tests__/sweep-error-classifier.test.ts
 * PURPOSE: Regression guard for Sentry MUSHI-MUSHI-SERVER-B.
 *
 *          The dogfood repo (kensaurus/mushi-mushi) had its PAT revoked
 *          around 2026-04-22. Every hourly sweep then threw
 *          `Error('tree fetch 401')`, which the catch-site funnelled into
 *          `log.error('sweep: repo index failed', ...)`. The structured
 *          logger forwards `.error` to Sentry as a captured message, and
 *          Sentry creates an Issue per message regardless of severity, so
 *          the same operator-config condition kept regressing the issue
 *          for ~30 days.
 *
 *          This test pins the classifier so a future "let's just simplify
 *          the regex" refactor can't accidentally re-promote 401/403 to
 *          'unknown' (which routes back to `log.error` and Sentry).
 */

import { describe, expect, it } from 'vitest';

import { classifyIndexerError } from '../../supabase/functions/_shared/sweep-error-classifier.ts';

describe('classifyIndexerError — Sentry noise routing for sweep failures', () => {
  describe('auth — operator must reconnect GitHub before retries help', () => {
    it.each([
      ['tree fetch 401', '401 from /git/trees/main'],
      ['installation token mint failed: 401', 'App install JWT exchange rejected'],
      ['contents fetch 401', 'per-file contents endpoint rejected'],
      ['no_token: neither github_app_installation_id nor project_settings.github_installation_token_ref resolved', 'token resolution returned null'],
      ['no token', 'short form'],
      ['Bad credentials', 'GitHub-style auth rejection'],
      ['Requires authentication', 'GitHub-style auth rejection'],
      ['tree fetch 403', 'forbidden — token lacks scope'],
    ])('classifies %j as auth (%s)', (msg) => {
      expect(classifyIndexerError(new Error(msg))).toBe('auth');
    });
  });

  describe('permission — token valid but project lost access to the repo', () => {
    it.each([
      ['tree fetch 404', 'repo deleted or made private'],
      ['contents fetch 404', 'file gone, but token still valid'],
      ['Resource not accessible by integration', 'GitHub App lost repo permission'],
      ['not accessible', 'short form'],
    ])('classifies %j as permission (%s)', (msg) => {
      expect(classifyIndexerError(new Error(msg))).toBe('permission');
    });
  });

  describe('transient — upstream wobble, hourly cron will retry', () => {
    it.each([
      ['tree fetch 502', 'GitHub bad gateway'],
      ['installation token mint failed: 503', 'GitHub maintenance'],
      ['tree fetch 504', 'GitHub timeout'],
      ['fetch failed', 'Deno fetch network failure'],
      ['network unreachable', 'connectivity gone'],
      ['Request too large for text-embedding-3-small … Limit 50000000, Requested 114', 'OpenAI TPM ceiling'],
      ['Rate limit exceeded', 'OpenAI / GitHub rate limit'],
      ['ECONNRESET', 'TCP reset'],
      ['operation timeout after 30000ms', 'embedding call timeout'],
    ])('classifies %j as transient (%s)', (msg) => {
      expect(classifyIndexerError(new Error(msg))).toBe('transient');
    });
  });

  describe('unknown — real server bugs, route to Sentry', () => {
    it.each([
      ["Cannot read properties of undefined (reading 'tree')", 'TypeError from schema drift'],
      ['Unexpected token < in JSON at position 0', 'GitHub returned HTML — surfaces as parse bug'],
      ['all chunk embeddings failed', 'every batch failed without a transient marker'],
      ['bad_repo_url', 'malformed project_repos.repo_url'],
    ])('classifies %j as unknown (%s)', (msg) => {
      expect(classifyIndexerError(new Error(msg))).toBe('unknown');
    });
  });

  describe('input shape resilience', () => {
    it('handles plain string errors thrown via `throw "..."`', () => {
      expect(classifyIndexerError('tree fetch 401')).toBe('auth');
    });

    it('handles null / undefined without throwing', () => {
      expect(classifyIndexerError(null)).toBe('unknown');
      expect(classifyIndexerError(undefined)).toBe('unknown');
    });

    it('handles non-Error objects via String() coercion', () => {
      expect(classifyIndexerError({ toString: () => 'tree fetch 403' })).toBe('auth');
    });
  });

  describe('priority ordering', () => {
    it('prefers the explicit "no_token" phrase over generic digit matches', () => {
      expect(classifyIndexerError(new Error('no_token: 401 fallback also empty'))).toBe('auth');
    });

    it('prefers "Resource not accessible" over a 403 digit fallback', () => {
      expect(
        classifyIndexerError(
          new Error('Resource not accessible by integration (HTTP 403)'),
        ),
      ).toBe('permission');
    });
  });
});
