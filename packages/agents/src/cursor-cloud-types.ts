/**
 * FILE: packages/agents/src/cursor-cloud-types.ts
 * PURPOSE: Shared Cursor Cloud types for the Node-side FixOrchestrator.
 *          The adapter (cursor-cloud.ts) now talks to the Cursor REST API
 *          directly instead of @cursor/sdk, so this file only carries the
 *          DB-settings shape used by the orchestrator.
 *
 * RUNTIME CONSTRAINT: Node-only. Must NOT be imported from Deno edge
 * functions — Path A (Marketplace plugin) uses @mushi-mushi/plugin-cursor-cloud
 * which talks to Cursor's REST API directly from Deno.
 */

/** Stored Cursor credentials resolved from project_settings. */
export interface CursorProjectSettings {
  cursor_api_key_ref: string | null
  cursor_workspace_id: string | null
  cursor_default_model: string | null
  cursor_auto_create_pr: boolean | null
  cursor_max_iterations: number | null
}
