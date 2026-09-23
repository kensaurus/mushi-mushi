import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { buildDryRunResult, type DispatchReadiness } from './dispatch-dry-run.ts';

// The panel's contract (apps/admin DryRunPanel.tsx). Any value outside these
// sets renders a broken chip tone or a raw key instead of a label.
const PANEL_STEPS = ['preflight', 'repo_resolution', 'context_assembly', 'llm_call', 'pr_creation'];
const PANEL_STATUSES = ['pass', 'fail', 'skip', 'simulated'];

const allGood: DispatchReadiness = {
  repoUrl: 'https://github.com/kensaurus/glot.it',
  hasGithub: true,
  hasAnthropic: true,
  anthropicSource: 'env',
  hasCodebase: true,
  hasAutofix: true,
  hasEmbedding: true,
  embeddingSource: 'byok',
};

const byStep = (r: DispatchReadiness) =>
  Object.fromEntries(buildDryRunResult(r).simulatedSteps.map((s) => [s.step, s.status]));

Deno.test('dry-run: every real check passing → ready, with the LLM and PR steps simulated', () => {
  const result = buildDryRunResult(allGood);
  assertEquals(result.ready, true);
  assertEquals(
    result.simulatedSteps.map((s) => [s.step, s.status]),
    [
      ['preflight', 'pass'],
      ['repo_resolution', 'pass'],
      ['context_assembly', 'pass'],
      ['llm_call', 'simulated'],
      ['pr_creation', 'simulated'],
    ],
  );
  assertEquals(result.estimatedCostUsd, null);
});

Deno.test('dry-run: a missing repo fails only repo_resolution and blocks readiness', () => {
  const result = buildDryRunResult({ ...allGood, hasGithub: false, repoUrl: null });
  assertEquals(result.ready, false);
  const steps = byStep({ ...allGood, hasGithub: false, repoUrl: null });
  assertEquals(steps.repo_resolution, 'fail');
  assertEquals(steps.preflight, 'pass');
  assertEquals(steps.context_assembly, 'pass');
});

Deno.test('dry-run: autofix off or no Anthropic key fails preflight', () => {
  assertEquals(byStep({ ...allGood, hasAutofix: false }).preflight, 'fail');
  assertEquals(
    byStep({ ...allGood, hasAnthropic: false, anthropicSource: null }).preflight,
    'fail',
  );
});

Deno.test(
  'dry-run: no embedding key fails context_assembly — the step that skipped a live dispatch on 2026-09-23',
  () => {
    // Anthropic resolved, repo connected, index on — and the worker still
    // ended `skipped_no_context` because the BYOK OpenAI key was revoked.
    // A dry-run that only checked Anthropic would have said "ready".
    const steps = byStep({ ...allGood, hasEmbedding: false, embeddingSource: null });
    assertEquals(steps.context_assembly, 'fail');
    assertEquals(steps.preflight, 'pass');
    assertEquals(steps.repo_resolution, 'pass');
    assertEquals(
      buildDryRunResult({ ...allGood, hasEmbedding: false, embeddingSource: null }).ready,
      false,
    );
  },
);

Deno.test('dry-run: indexing off fails context_assembly even with a key', () => {
  assertEquals(byStep({ ...allGood, hasCodebase: false }).context_assembly, 'fail');
});

Deno.test('dry-run: simulated steps never count against readiness', () => {
  // Only the three real checks decide `ready`; the two simulated steps are
  // informational. If a future change marks them fail/skip, this catches it.
  const real = buildDryRunResult(allGood).simulatedSteps.filter((s) => s.status !== 'simulated');
  assertEquals(real.length, 3);
});

Deno.test('dry-run: every step/status is one the panel can render', () => {
  for (const readiness of [
    allGood,
    {
      ...allGood,
      hasGithub: false,
      hasCodebase: false,
      hasAutofix: false,
      hasAnthropic: false,
      hasEmbedding: false,
    },
  ]) {
    for (const step of buildDryRunResult(readiness).simulatedSteps) {
      assertEquals(PANEL_STEPS.includes(step.step), true, `unknown step ${step.step}`);
      assertEquals(PANEL_STATUSES.includes(step.status), true, `unknown status ${step.status}`);
      assertEquals(step.detail.length > 0, true, `empty detail for ${step.step}`);
    }
  }
});
