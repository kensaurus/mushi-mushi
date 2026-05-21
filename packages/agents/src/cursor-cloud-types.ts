/**
 * FILE: packages/agents/src/cursor-cloud-types.ts
 * PURPOSE: Typed wrappers around @cursor/sdk so the adapter doesn't leak the
 *          SDK's internal types across files, and so this module stays
 *          importable even when @cursor/sdk is not installed (it is an
 *          optional peer dep — the adapter falls back to the REST path).
 *
 * RUNTIME CONSTRAINT: @cursor/sdk is Node-only. This file MUST NOT be
 * imported from any Deno edge function. The Path A (Marketplace plugin)
 * calls Cursor's HTTP REST API directly from Deno; Path B (autofix_agent)
 * imports this from the Node-side orchestrator only.
 */

import type { Agent, SDKAgent, Run, RunResult, SDKArtifact } from '@cursor/sdk'

// Re-export SDK types under stable local names. The adapter imports these
// rather than @cursor/sdk directly so bundlers that prune the optional dep
// can still tree-shake the adapter.
export type { SDKAgent as CursorAgentHandle, Run as CursorRunHandle, RunResult as CursorRunResult, SDKArtifact as CursorArtifact }

/** Stored Cursor credentials resolved from project_settings. */
export interface CursorProjectSettings {
  cursor_api_key_ref: string | null
  cursor_workspace_id: string | null
  cursor_default_model: string | null
  cursor_auto_create_pr: boolean | null
  cursor_max_iterations: number | null
}

/**
 * Dynamically import @cursor/sdk and return the Agent constructor.
 * Returns null if the package is not installed (optional peer dep).
 *
 * Callers MUST handle the null case — the CursorCloudAgent adapter
 * falls back to a descriptive failure result when the SDK is unavailable.
 */
export async function loadCursorSdk(): Promise<{ Agent: typeof Agent } | null> {
  try {
    // Dynamic import so bundlers don't hard-fail when the peer dep is absent.
    const mod = await import('@cursor/sdk')
    return mod
  } catch {
    return null
  }
}
