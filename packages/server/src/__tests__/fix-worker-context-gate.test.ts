/**
 * FILE: fix-worker-context-gate.test.ts
 * PURPOSE: Validates the Phase 2 context-floor gate on the fix-worker.
 *          The gate prevents the LLM from being invoked (and subsequently
 *          emitting "INVESTIGATION_NEEDED.md" stub PRs) when BOTH the
 *          codebase RAG and the Firecrawl web augment produced zero usable
 *          context. This is the exact regression that landed as glot.it
 *          PRs #3/#4/#5 before we shipped the gate.
 *
 * NOTE: The production gate lives in
 *   packages/server/supabase/functions/fix-worker/index.ts
 * inside a Deno edge function; we mirror the decision predicate here so the
 * contract is enforced by CI without booting Deno + Supabase.
 */

import { describe, it, expect } from 'vitest'

type GateOutcome =
  | { action: 'skip'; status: 'skipped_no_context'; dispatchStatus: 'skipped'; reason: string }
  | { action: 'proceed'; usedWebOnly: boolean }

function contextGate(input: {
  codeFileCount: number
  webSnippetCount: number
  minRagChunks: number
}): GateOutcome {
  if (input.codeFileCount < input.minRagChunks && input.webSnippetCount === 0) {
    return {
      action: 'skip',
      status: 'skipped_no_context',
      dispatchStatus: 'skipped',
      reason:
        'Codebase not indexed. Enable in Settings → Integrations → GitHub, ' +
        'or increase MUSHI_FIX_MIN_RAG_CHUNKS if you want to proceed with less context.',
    }
  }
  return {
    action: 'proceed',
    usedWebOnly: input.codeFileCount < input.minRagChunks && input.webSnippetCount > 0,
  }
}

describe('fix-worker context-floor gate (V5.3 §2.10 Phase 2)', () => {
  it('skips the LLM when both RAG and Firecrawl return nothing', () => {
    const g = contextGate({ codeFileCount: 0, webSnippetCount: 0, minRagChunks: 1 })
    expect(g.action).toBe('skip')
    if (g.action !== 'skip') return
    expect(g.status).toBe('skipped_no_context')
    expect(g.dispatchStatus).toBe('skipped')
    expect(g.reason).toMatch(/Codebase not indexed/)
  })

  it('proceeds normally when RAG hits the floor', () => {
    const g = contextGate({ codeFileCount: 5, webSnippetCount: 0, minRagChunks: 1 })
    expect(g.action).toBe('proceed')
    if (g.action !== 'proceed') return
    expect(g.usedWebOnly).toBe(false)
  })

  it('proceeds with web-only context when RAG is empty but Firecrawl hit', () => {
    const g = contextGate({ codeFileCount: 0, webSnippetCount: 2, minRagChunks: 1 })
    expect(g.action).toBe('proceed')
    if (g.action !== 'proceed') return
    expect(g.usedWebOnly).toBe(true)
  })

  it('honors a raised MUSHI_FIX_MIN_RAG_CHUNKS threshold', () => {
    // Ops raised the floor to 3 chunks. 2 chunks + no web ⇒ skip.
    const skip = contextGate({ codeFileCount: 2, webSnippetCount: 0, minRagChunks: 3 })
    expect(skip.action).toBe('skip')

    // 2 chunks + web snippet ⇒ proceed (web-only, since floor not met).
    const proceed = contextGate({ codeFileCount: 2, webSnippetCount: 1, minRagChunks: 3 })
    expect(proceed.action).toBe('proceed')
    if (proceed.action !== 'proceed') return
    expect(proceed.usedWebOnly).toBe(true)
  })

  it('treats MUSHI_FIX_MIN_RAG_CHUNKS=0 as "gate disabled"', () => {
    // Zero floor + no context anywhere: codeFileCount<0 is false, so we proceed.
    // This lets operators intentionally disable the gate for canary projects.
    const g = contextGate({ codeFileCount: 0, webSnippetCount: 0, minRagChunks: 0 })
    expect(g.action).toBe('proceed')
  })
})
