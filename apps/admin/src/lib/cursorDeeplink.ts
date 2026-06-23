/**
 * FILE: apps/admin/src/lib/cursorDeeplink.ts
 * PURPOSE: Back-compat re-exports for Cursor and VS Code deeplink builders.
 *
 * OVERVIEW:
 * - The canonical implementations now live in `packages/mcp/src/clients.ts`
 *   (shared registry). This file re-exports the named functions that existing
 *   callers in McpPage and McpInstallButtons depend on, so no import paths
 *   need to change outside this file.
 * - New code should import directly from `@mushi-mushi/mcp/clients` instead.
 *
 * DEPENDENCIES:
 * - @mushi-mushi/mcp/clients  (shared pure builders)
 * - @mushi-mushi/mcp/feature-groups
 * - @mushi-mushi/mcp/branding
 *
 * USAGE:
 *   import { buildCursorDeeplink, buildVsCodeDeeplink } from '@/lib/cursorDeeplink'
 *   // Works exactly as before — all signatures preserved.
 */

import {
  DEFAULT_FEATURE_GROUPS,
  appendFeaturesToUrl,
  featuresQueryString,
} from '@mushi-mushi/mcp/feature-groups'
import { MUSHI_ICON_PNG_URL } from '@mushi-mushi/mcp/branding'
import { projectServerName } from '@mushi-mushi/mcp/clients'

interface McpStdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
  icon?: string
}

interface McpHttpConfig {
  type: 'http'
  url: string
  headers: Record<string, string>
  icon?: string
}

/** Build the npm-exec server config for stdio transport (recommended for Cursor — correct icon). */
export function buildStdioConfig(
  projectId: string,
  apiKey: string,
  apiEndpoint: string,
  options?: { features?: readonly string[] },
): McpStdioConfig {
  const features = options?.features ?? DEFAULT_FEATURE_GROUPS
  return {
    command: 'npx',
    args: ['-y', '@mushi-mushi/mcp@latest'],
    env: {
      MUSHI_API_ENDPOINT: apiEndpoint,
      MUSHI_API_KEY: apiKey,
      MUSHI_PROJECT_ID: projectId,
      MUSHI_FEATURES: featuresQueryString(features as typeof DEFAULT_FEATURE_GROUPS),
    },
    icon: MUSHI_ICON_PNG_URL,
  }
}

/** Hosted Streamable HTTP MCP config (CI / no subprocess). Appends lean ?features= by default. */
export function buildHttpConfig(
  projectId: string,
  apiKey: string,
  mcpHttpUrl: string,
  options?: { features?: readonly string[]; featuresAll?: boolean },
): McpHttpConfig {
  const url = options?.featuresAll
    ? mcpHttpUrl
    : appendFeaturesToUrl(mcpHttpUrl, (options?.features ?? DEFAULT_FEATURE_GROUPS) as typeof DEFAULT_FEATURE_GROUPS)
  return {
    type: 'http',
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-Mushi-Api-Key': apiKey,
      'X-Mushi-Project-Id': projectId,
    },
    icon: MUSHI_ICON_PNG_URL,
  }
}

/** Build the org-scoped (account-level) stdio config — no MUSHI_PROJECT_ID set. */
export function buildOrgStdioConfig(
  apiKey: string,
  apiEndpoint: string,
  options?: { features?: readonly string[] },
): McpStdioConfig {
  const features = options?.features ?? DEFAULT_FEATURE_GROUPS
  return {
    command: 'npx',
    args: ['-y', '@mushi-mushi/mcp@latest'],
    env: {
      MUSHI_API_ENDPOINT: apiEndpoint,
      MUSHI_API_KEY: apiKey,
      MUSHI_FEATURES: featuresQueryString(features as typeof DEFAULT_FEATURE_GROUPS),
    },
    icon: MUSHI_ICON_PNG_URL,
  }
}

/** One-click Cursor deeplink for an org-scoped key (all projects, no fixed MUSHI_PROJECT_ID). */
export function buildCursorOrgDeeplink(accountLabel: string, apiKey: string, apiEndpoint: string): string {
  const slug = accountLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  return encodeCursorInstallDeeplink(`mushi-${slug}`, buildOrgStdioConfig(apiKey, apiEndpoint))
}

/** VS Code deeplink for an org-scoped key. */
export function buildVsCodeOrgDeeplink(accountLabel: string, apiKey: string, apiEndpoint: string): string {
  const slug = accountLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
  return encodeVsCodeInstallDeeplink(`mushi-${slug}`, buildOrgStdioConfig(apiKey, apiEndpoint))
}

// Re-export from shared registry for new consumers.
export { projectServerName }

function encodeCursorInstallDeeplink(name: string, config: McpStdioConfig | McpHttpConfig): string {
  const encoded = btoa(JSON.stringify(config))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encoded)}`
}

function toVsCodeInstallConfig(config: McpStdioConfig | McpHttpConfig): McpHttpConfig | (McpStdioConfig & { type: 'stdio' }) {
  if ('type' in config && config.type === 'http') return config
  return { type: 'stdio', ...config }
}

function encodeVsCodeInstallDeeplink(name: string, config: McpStdioConfig | McpHttpConfig): string {
  return `vscode:mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(JSON.stringify(toVsCodeInstallConfig(config)))}`
}

/** One-click Cursor MCP install URL (stdio transport — recommended). */
export function buildCursorDeeplink(
  projectId: string,
  projectName: string,
  apiKey: string,
  apiEndpoint: string,
): string {
  const name = projectServerName(projectId, projectName)
  return encodeCursorInstallDeeplink(name, buildStdioConfig(projectId, apiKey, apiEndpoint))
}

/** One-click Cursor MCP install URL (hosted HTTP transport). */
export function buildCursorHttpDeeplink(
  projectId: string,
  projectName: string,
  apiKey: string,
  mcpHttpUrl: string,
): string {
  const name = projectServerName(projectId, projectName)
  return encodeCursorInstallDeeplink(name, buildHttpConfig(projectId, apiKey, mcpHttpUrl))
}

/** VS Code deeplink — stdio transport. */
export function buildVsCodeDeeplink(
  projectId: string,
  projectName: string,
  apiKey: string,
  apiEndpoint: string,
): string {
  const name = projectServerName(projectId, projectName)
  return encodeVsCodeInstallDeeplink(name, buildStdioConfig(projectId, apiKey, apiEndpoint))
}

/** VS Code deeplink — hosted HTTP transport. */
export function buildVsCodeHttpDeeplink(
  projectId: string,
  projectName: string,
  apiKey: string,
  mcpHttpUrl: string,
): string {
  const name = projectServerName(projectId, projectName)
  return encodeVsCodeInstallDeeplink(name, buildHttpConfig(projectId, apiKey, mcpHttpUrl))
}
