/**
 * FILE: apps/admin/src/lib/mcpSetupView.ts
 * PURPOSE: What the Editor agents (MCP) page draws from its stats and keys,
 *          kept pure so the page and its tests read the same answer.
 *
 * Round-2 review (2026-11-18):
 *   - the mcp.json helper warned "MUSHI_API_KEY should start with mushi_"
 *     under an empty textarea: it validated the generated snippet (with its
 *     placeholder key) whenever nothing was pasted. It checks only what the
 *     user pasted now.
 *   - "Mint MCP key" showed while an MCP key already existed.
 */

import { validateMcpJsonSyntax, type McpJsonCheck } from './mcpPageHelpers'

/** The helper's verdict on what was pasted; nothing pasted is no verdict, not a warning. */
export function mcpJsonDraftCheck(draft: string): McpJsonCheck | null {
  return draft.trim() ? validateMcpJsonSyntax(draft) : null
}

interface AccountKeyLike {
  id: string
  label: string | null
  scopes: readonly string[]
  all_projects: boolean
  projects: ReadonlyArray<{ id: string }>
}

/**
 * The account key (no project of its own, ADR 0026) that already gives an
 * editor MCP access to this app, if any. The project's own key counts said
 * "no MCP key" and offered "Mint MCP key" while cursor-mcp-org reached every
 * project (round-2 review 2026-11-18).
 */
export function accountKeyForProject<T extends AccountKeyLike>(keys: readonly T[] | null | undefined, projectId: string | null): T | null {
  if (!projectId || !keys) return null
  return (
    keys.find(
      (k) => k.scopes.some((s) => s.startsWith('mcp:')) && (k.all_projects || k.projects.some((p) => p.id === projectId)),
    ) ?? null
  )
}

/**
 * Step 1 of the Editor agents quick start: which key gives an editor access.
 * A green tick sat over a green "0 MCP keys on kensaur.us" while the account
 * key cursor-mcp-org reached the app (round-3 review 2026-11-19); the step now
 * names the key that counts, and is open only when none does.
 */
export function mcpKeyStep(
  projectKeyCount: number,
  accountKeyLabel: string | null | undefined,
): { done: boolean; text: string | null } {
  if (projectKeyCount > 0) {
    return { done: true, text: `${projectKeyCount} MCP key${projectKeyCount === 1 ? '' : 's'} on this app.` }
  }
  if (accountKeyLabel !== undefined && accountKeyLabel !== null) {
    return { done: true, text: `Your account key ${accountKeyLabel || '(unnamed)'} reaches this app.` }
  }
  return { done: false, text: null }
}
