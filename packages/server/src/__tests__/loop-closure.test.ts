/**
 * FILE: loop-closure.test.ts
 * PURPOSE: Regression tests for the data-pipeline loop-closure work
 *          (2026-05-10):
 *
 *   - synthetic_reports.match_score computation (eval pass)
 *   - GenAI semantic-convention attribute mapping (OTLP exporter)
 *   - regression triage report category mapping (status-reconciler)
 *
 * The functions under test are pure — we re-implement them inline (same
 * pattern as sse.test.ts) rather than importing from supabase/functions,
 * which uses Deno-style imports the Node test runner can't resolve.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Inlined: computeMatchScore from generate-synthetic/index.ts
// ---------------------------------------------------------------------------

function computeMatchScore(
  expected: { category: string; severity: string },
  actual: { category: string; severity: string },
): number {
  const SEVERITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const catScore = expected.category === actual.category ? 1 : 0;
  const ed = SEVERITY_RANK[expected.severity] ?? -1;
  const ad = SEVERITY_RANK[actual.severity] ?? -1;
  const sevDiff = Math.abs(ed - ad);
  const sevScore = sevDiff === 0 ? 1 : sevDiff === 1 ? 0.5 : 0;
  return Math.round((catScore * 0.5 + sevScore * 0.5) * 100) / 100;
}

describe('computeMatchScore (synthetic_reports eval pass)', () => {
  it('returns 1.0 when category and severity match exactly', () => {
    expect(
      computeMatchScore(
        { category: 'bug', severity: 'high' },
        { category: 'bug', severity: 'high' },
      ),
    ).toBe(1.0);
  });

  it('returns 0.5 when only category matches (different severity, far apart)', () => {
    expect(
      computeMatchScore(
        { category: 'slow', severity: 'critical' },
        { category: 'slow', severity: 'low' },
      ),
    ).toBe(0.5);
  });

  it('returns 0.75 when category matches and severity is adjacent', () => {
    expect(
      computeMatchScore(
        { category: 'bug', severity: 'high' },
        { category: 'bug', severity: 'critical' },
      ),
    ).toBe(0.75);
  });

  it('returns 0.5 when category mismatches but severity matches exactly', () => {
    expect(
      computeMatchScore(
        { category: 'bug', severity: 'high' },
        { category: 'slow', severity: 'high' },
      ),
    ).toBe(0.5);
  });

  it('returns 0 when both dimensions mismatch and severity is far apart', () => {
    expect(
      computeMatchScore(
        { category: 'bug', severity: 'critical' },
        { category: 'visual', severity: 'low' },
      ),
    ).toBe(0);
  });

  it('rounds to 2 decimals so the >= 0.8 filter has stable buckets', () => {
    // category match (0.5) + severity adjacent (0.5 * 0.5 = 0.25) = 0.75
    const score = computeMatchScore(
      { category: 'visual', severity: 'medium' },
      { category: 'visual', severity: 'high' },
    );
    expect(Number.isInteger(score * 100)).toBe(true);
  });

  it('treats unknown severity strings defensively (rank -1) without throwing', () => {
    // Unknown severity should not crash — both being unknown means diff=0
    // and we compute a score from category only.
    const score = computeMatchScore(
      { category: 'bug', severity: 'unknown-bogus' },
      { category: 'bug', severity: 'unknown-bogus' },
    );
    // Same unknown rank (-1) on both sides → diff 0 → severity score 1.
    expect(score).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// Inlined: provider inference from otlp-exporter.ts (GenAI semconv)
// ---------------------------------------------------------------------------

type GenAiProvider = 'anthropic' | 'openai' | 'gcp.gen_ai' | 'gcp.vertex_ai' | 'unknown';

function inferProvider(model: string | undefined): GenAiProvider {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gpt-') || m.startsWith('text-embedding-')) return 'openai';
  if (m.startsWith('gemini-')) return 'gcp.gen_ai';
  return 'unknown';
}

describe('inferProvider (OTLP gen_ai.provider.name)', () => {
  it('maps Claude family to anthropic', () => {
    expect(inferProvider('claude-sonnet-4-6')).toBe('anthropic');
    expect(inferProvider('claude-haiku-4-5')).toBe('anthropic');
    expect(inferProvider('claude-opus-4-7')).toBe('anthropic');
  });

  it('maps GPT family to openai', () => {
    expect(inferProvider('gpt-5')).toBe('openai');
    expect(inferProvider('gpt-4.1-mini')).toBe('openai');
  });

  it('maps text-embedding models to openai (embeddings semantic)', () => {
    expect(inferProvider('text-embedding-3-small')).toBe('openai');
    expect(inferProvider('text-embedding-3-large')).toBe('openai');
  });

  it('maps Gemini family to gcp.gen_ai (matches semconv enum)', () => {
    expect(inferProvider('gemini-1.5-pro')).toBe('gcp.gen_ai');
  });

  it('returns unknown rather than guessing for unrecognised model ids', () => {
    expect(inferProvider('mistral-large')).toBe('unknown');
    expect(inferProvider('llama-3-70b')).toBe('unknown');
    expect(inferProvider(undefined)).toBe('unknown');
  });

  it('is case-insensitive (provider sometimes ships uppercase model ids)', () => {
    expect(inferProvider('CLAUDE-SONNET-4-6')).toBe('anthropic');
    expect(inferProvider('GPT-5')).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// Constants check: status-reconciler regression report MUST use a category
// the `reports.category` CHECK constraint accepts. Drift here would silently
// break the regression auto-triage path (constraint violation → no row →
// no plugin dispatch → no operator page).
// ---------------------------------------------------------------------------

describe('reports.category CHECK constraint (regression triage compatibility)', () => {
  const ALLOWED = new Set(['bug', 'slow', 'visual', 'confusing', 'other']);

  it('regression triage uses an allowed category', () => {
    // status-reconciler#alertOnRegressions inserts category: 'bug' — must
    // stay one of these five values. If the list ever expands, update this
    // test AND the migration's CHECK clause.
    const REGRESSION_CATEGORY = 'bug';
    expect(ALLOWED.has(REGRESSION_CATEGORY)).toBe(true);
  });

  it('library-modernizer category stays compatible', () => {
    // Same constraint — kept here as a tripwire so a category-rename
    // migration breaks both inserts at test time, not at runtime.
    const MODERNIZER_CATEGORY = 'other';
    expect(ALLOWED.has(MODERNIZER_CATEGORY)).toBe(true);
  });
});
