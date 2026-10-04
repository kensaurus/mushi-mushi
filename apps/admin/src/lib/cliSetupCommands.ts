/**
 * FILE: apps/admin/src/lib/cliSetupCommands.ts
 * PURPOSE: Pure helpers for CLI copy blocks shown in Connect + post-create panels.
 *
 * NOTES:
 * - `mushi connect` writes .env.local + Cursor MCP by default; `--write-env`
 *   and `--wire-ide` are explicit aliases for copy-paste clarity.
 * - The endpoint is required: callers pass `RESOLVED_EXTERNAL_API_URL`, the API
 *   this console talks to. A Mushi Cloud default sent self-hosted operators'
 *   apps to the cloud (QA bug 142).
 */

export function buildMushiInitCommand(projectId: string, apiKey?: string | null): string {
  if (apiKey) return `mushi init --project-id ${projectId} --api-key ${apiKey}`
  return `mushi init --project-id ${projectId}`
}

export function buildMushiConnectCommand(projectId: string, endpoint: string): string {
  return (
    `MUSHI_API_KEY=mushi_xxx mushi connect --project-id ${projectId} ` +
    `--endpoint ${endpoint} --write-env --wire-ide --wait`
  )
}

/**
 * `mushi doctor` runs both tracks; each command below skips the other one.
 * The CLI declares only `--no-server` / `--no-ingest` (commander), so the
 * `--ingest` / `--server` forms the console used to copy exit with
 * "unknown option" (QA bug 122).
 */
export const DOCTOR_INGEST_ONLY = 'mushi doctor --no-server'
export const DOCTOR_DISPATCH_ONLY = 'mushi doctor --no-ingest'
