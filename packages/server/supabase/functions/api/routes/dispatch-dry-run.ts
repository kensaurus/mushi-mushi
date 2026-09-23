/**
 * FILE: api/routes/dispatch-dry-run.ts
 * PURPOSE: The pure half of POST /v1/admin/projects/:id/fixes/dry-run — the
 *          readiness shape and the five-step result DryRunPanel renders.
 *
 *          Deliberately import-free. The route module (project-integrations.ts)
 *          pulls in _shared/* which reads env at import time, so it cannot be
 *          loaded under CI's `deno test` permissions (no --allow-env). Keeping
 *          the logic here lets project-integrations.test.ts exercise it with
 *          no permissions at all.
 */

/** The signals that decide whether a fix can be dispatched. */
export interface DispatchReadiness {
  repoUrl: string | null;
  hasGithub: boolean;
  hasAnthropic: boolean;
  anthropicSource: string | null;
  hasCodebase: boolean;
  hasAutofix: boolean;
  /**
   * An embedding key resolves (BYOK OpenAI or the platform fallback). RAG
   * context assembly needs it, and it is what actually sank a live dispatch
   * on 2026-09-23: Anthropic resolved fine, the BYOK OpenAI key was revoked,
   * and the worker filed the 401 as "no relevant code". Resolution only —
   * this does not prove the key is still valid.
   */
  hasEmbedding: boolean;
  embeddingSource: string | null;
}

/**
 * Contract of DryRunPanel.tsx (apps/admin): `step` must be one of its
 * STEP_LABELS keys and `status` one of its STEP_TONE keys — any other value
 * degrades the chip tone and label silently rather than erroring.
 */
export interface DryRunStep {
  step: 'preflight' | 'repo_resolution' | 'context_assembly' | 'llm_call' | 'pr_creation';
  status: 'pass' | 'fail' | 'skip' | 'simulated';
  detail: string;
}

export interface DryRunResult {
  ready: boolean;
  simulatedSteps: DryRunStep[];
  estimatedCostUsd: number | null;
  note: string;
}

/**
 * Pure: turns readiness into the five-step dry-run the panel renders. The
 * first three steps are real checks; the LLM call and PR creation are always
 * `simulated` — not executing them is the whole point of a dry-run.
 * `estimatedCostUsd` stays null rather than inventing a number the pipeline
 * does not measure.
 */
export function buildDryRunResult(r: DispatchReadiness): DryRunResult {
  const steps: DryRunStep[] = [
    {
      step: 'preflight',
      status: r.hasAutofix && r.hasAnthropic ? 'pass' : 'fail',
      detail: !r.hasAutofix
        ? 'Autofix is off — turn it on in Project Settings.'
        : !r.hasAnthropic
          ? 'No Anthropic key resolves for this project (BYOK or platform).'
          : `Autofix on · Anthropic key via ${r.anthropicSource ?? 'unknown'}.`,
    },
    {
      step: 'repo_resolution',
      status: r.hasGithub ? 'pass' : 'fail',
      detail: r.hasGithub
        ? `Repo: ${r.repoUrl ?? 'configured'}`
        : 'No GitHub repo connected — the fix worker has no target for a PR.',
    },
    {
      step: 'context_assembly',
      status: r.hasCodebase && r.hasEmbedding ? 'pass' : 'fail',
      detail: !r.hasCodebase
        ? 'Codebase indexing is off — the agent would work from the report alone.'
        : !r.hasEmbedding
          ? 'No OpenAI embedding key resolves (BYOK or platform) — the RAG lookup fails and a live dispatch is skipped as "no relevant code".'
          : `Codebase index enabled · embeddings via the ${r.embeddingSource ?? 'unknown'} key.`,
    },
    { step: 'llm_call', status: 'simulated', detail: 'Not executed in a dry-run.' },
    { step: 'pr_creation', status: 'simulated', detail: 'Not executed in a dry-run.' },
  ];
  const ready = steps.filter((s) => s.status !== 'simulated').every((s) => s.status === 'pass');
  return {
    ready,
    simulatedSteps: steps,
    estimatedCostUsd: null,
    note: ready
      ? 'Every real check passed; a live dispatch would call the LLM and open a draft PR.'
      : 'Fix the failed steps above before dispatching — a live run stops at the first failure.',
  };
}
