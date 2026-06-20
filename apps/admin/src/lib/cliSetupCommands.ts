/**
 * FILE: apps/admin/src/lib/cliSetupCommands.ts
 * PURPOSE: Pure helpers for CLI copy blocks shown in Connect + post-create panels.
 *
 * NOTES:
 * - `mushi connect` writes .env.local + Cursor MCP by default; `--write-env`
 *   and `--wire-ide` are explicit aliases for copy-paste clarity.
 * - Pass the cloud API URL from `RESOLVED_EXTERNAL_API_URL` in UI callers.
 */

/** Default Mushi Cloud API — matches `@mushi-mushi/cli` CLOUD_API_ENDPOINT. */
export const DEFAULT_MUSHI_API_ENDPOINT =
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'

export function buildMushiInitCommand(projectId: string, apiKey?: string | null): string {
  if (apiKey) return `mushi init --project-id ${projectId} --api-key ${apiKey}`
  return `mushi init --project-id ${projectId}`
}

export function buildMushiConnectCommand(
  projectId: string,
  endpoint = DEFAULT_MUSHI_API_ENDPOINT,
): string {
  return (
    `MUSHI_API_KEY=mushi_xxx mushi connect --project-id ${projectId} ` +
    `--endpoint ${endpoint} --write-env --wire-ide --wait`
  )
}
