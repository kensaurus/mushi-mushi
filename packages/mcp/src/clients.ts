/**
 * FILE: packages/mcp/src/clients.ts
 * PURPOSE: Shared, pure (React-free) client registry + install-config builders for
 *          every supported AI agent / IDE client.
 *
 * OVERVIEW:
 * - Exports `MCP_CLIENTS: McpClientDef[]` — one entry per supported client.
 * - Each entry carries metadata (id, label, method, transport) and a pure `build()`
 *   function that returns the install artifact (deeplink URL, JSON config, or CLI command).
 * - Both the admin console ConnectStudio and the public docs /connect landing consume
 *   this module — the single source of truth so the two surfaces never drift.
 *
 * DEPENDENCIES:
 * - feature-groups.ts  (DEFAULT_FEATURE_GROUPS, featuresQueryString, appendFeaturesToUrl)
 * - branding.ts        (MUSHI_ICON_PNG_URL)
 *
 * USAGE:
 *   import { MCP_CLIENTS } from '@mushi-mushi/mcp/clients'
 *   const cursor = MCP_CLIENTS.find(c => c.id === 'cursor')!
 *   const result = cursor.build({ projectId, projectName, apiKey, endpoint, mcpHttpUrl })
 *   // result.kind === 'deeplink' → window.open(result.url)
 *
 * CLIENT INSTALL MATRIX (verified Jun 2026):
 * - cursor / vscode / vscode-insiders  — one-click deeplink
 * - windsurf                           — copy-config to ~/.codeium/windsurf/mcp_config.json
 *                                        (uses `serverUrl`, NOT `url` — common footgun)
 * - cline                              — copy-config to cline_mcp_settings.json
 * - claude-code                        — CLI command: claude mcp add --transport http …
 * - claude-desktop                     — copy-config to claude_desktop_config.json
 * - zed                                — copy-config to ~/.config/zed/settings.json
 * - any                                — hosted Streamable HTTP URL + Bearer key
 *
 * NOTES:
 * - All builders are pure functions — no side-effects, no DOM, no React.
 * - Cursor base64-encodes the config object without a `name` key in the payload.
 * - VS Code includes `type:'stdio'` in the config and `name` as a separate query param.
 * - Windsurf uses `serverUrl` for remote HTTP (NOT `url`) — encoding both would break it.
 * - The `cliIde` field drives `mushi setup --ide <cliIde>` in the CLI lane.
 */

import {
  DEFAULT_FEATURE_GROUPS,
  appendFeaturesToUrl,
  featuresQueryString,
  type FeatureGroup,
} from './feature-groups.js'
import { MUSHI_ICON_PNG_URL } from './branding.js'

/**
 * Pinned npm spec written into persistent MCP configs (mcp.json, settings.json).
 * Pinning avoids the supply-chain and cold-start costs of `@latest` on every
 * editor launch. Synced to package.json by `scripts/sync-mcp-pin.mjs` — never
 * hand-edit the version.
 */
export const MCP_PIN_SPEC = '@mushi-mushi/mcp@0.19.0'

// ─── Internal config shapes ────────────────────────────────────────────────────

interface StdioConfig {
  command: string
  args: string[]
  env: Record<string, string>
  icon?: string
}

interface HttpConfig {
  type: 'http'
  url: string
  headers: Record<string, string>
  icon?: string
}

/** Windsurf remote HTTP config — identical to HttpConfig except the key is `serverUrl`. */
interface WindsurfHttpConfig {
  type: 'http'
  serverUrl: string
  headers: Record<string, string>
  icon?: string
}

// ─── Public types ──────────────────────────────────────────────────────────────

export type McpClientId =
  | 'cursor'
  | 'vscode'
  | 'vscode-insiders'
  | 'windsurf'
  | 'cline'
  | 'claude-code'
  | 'claude-desktop'
  | 'zed'
  | 'any'

/** The install method determines which UI treatment the console/docs page renders. */
export type McpInstallMethod = 'deeplink' | 'config-json' | 'cli-command' | 'remote-url'

export interface McpBuildInput {
  /** Mushi project UUID — optional when building org-level configs. */
  projectId?: string
  projectName: string
  apiKey: string
  /** Supabase edge function base URL (`MUSHI_API_ENDPOINT`). */
  endpoint: string
  /** Hosted Streamable HTTP MCP URL (`RESOLVED_MCP_HTTP_URL`). */
  mcpHttpUrl: string
  /**
   * Restrict the exposed tool groups. Omitted → each client's existing default
   * (the lean `DEFAULT_FEATURE_GROUPS` for stdio deeplinks; all tools for the
   * config-json clients that historically set no `MUSHI_FEATURES`). The public
   * keyless demo passes an explicit read-only subset here.
   */
  features?: readonly FeatureGroup[]
  /**
   * Hosted HTTP transport only: append `?read_only=1` so the server hides and
   * blocks write tools regardless of key scope. Used by the public demo on top
   * of an `mcp:read` key for defence in depth. No-op for stdio configs.
   */
  readOnly?: boolean
}

export type McpBuildResult =
  | { kind: 'deeplink'; url: string }
  | { kind: 'config'; filePath: string; json: string }
  | { kind: 'command'; text: string }
  | { kind: 'remote-url'; url: string; headerSnippet: string }

export interface McpClientDef {
  id: McpClientId
  label: string
  /** Short description shown in the client picker. */
  description: string
  method: McpInstallMethod
  transport: 'stdio' | 'http'
  /** Drives `mushi setup --ide <cliIde>` in the CLI lane. */
  cliIde?: 'cursor' | 'claude' | 'continue' | 'zed'
  build(input: McpBuildInput): McpBuildResult
}

// ─── Shared low-level helpers ─────────────────────────────────────────────────

/** Build a stable, unique, human-readable MCP server slug for a project. */
export function projectServerName(projectId: string, projectName: string): string {
  const nameSlug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 22)
  const idSuffix = projectId.replace(/-/g, '').slice(0, 6)
  return `mushi-${nameSlug}-${idSuffix}`
}

function buildStdioConfigObj(
  projectId: string | undefined,
  apiKey: string,
  apiEndpoint: string,
  features: readonly string[] = DEFAULT_FEATURE_GROUPS,
): StdioConfig {
  const env: Record<string, string> = {
    MUSHI_API_ENDPOINT: apiEndpoint,
    MUSHI_API_KEY: apiKey,
    MUSHI_FEATURES: featuresQueryString(features as typeof DEFAULT_FEATURE_GROUPS),
  }
  if (projectId) env.MUSHI_PROJECT_ID = projectId
  return {
    command: 'npx',
    args: ['-y', MCP_PIN_SPEC],
    env,
    icon: MUSHI_ICON_PNG_URL,
  }
}

/** Append `?read_only=1` to a hosted MCP URL when the caller requests it. */
function withReadOnly(baseUrl: string, readOnly: boolean | undefined): string {
  if (!readOnly) return baseUrl
  const url = new URL(baseUrl)
  url.searchParams.set('read_only', '1')
  return url.toString()
}

function buildHttpConfigObj(
  projectId: string | undefined,
  apiKey: string,
  mcpHttpUrl: string,
  features: readonly string[] = DEFAULT_FEATURE_GROUPS,
  readOnly = false,
): HttpConfig {
  const url = withReadOnly(
    appendFeaturesToUrl(mcpHttpUrl, features as typeof DEFAULT_FEATURE_GROUPS),
    readOnly,
  )
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'X-Mushi-Api-Key': apiKey,
  }
  if (projectId) headers['X-Mushi-Project-Id'] = projectId
  return { type: 'http', url, headers, icon: MUSHI_ICON_PNG_URL }
}

/** Cursor one-click deeplink — base64-encodes config, no `name` in the payload. */
function encodeCursorDeeplink(name: string, config: StdioConfig | HttpConfig): string {
  const encoded = btoa(JSON.stringify(config))
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(encoded)}`
}

function toVsCodeConfig(config: StdioConfig | HttpConfig): (StdioConfig & { type: 'stdio' }) | HttpConfig {
  if ('type' in config && config.type === 'http') return config
  return { type: 'stdio', ...config }
}

/** VS Code deeplink — URL-encodes JSON (with type:'stdio'), `name` is a separate query param. */
function encodeVsCodeDeeplink(scheme: 'vscode' | 'vscode-insiders', name: string, config: StdioConfig | HttpConfig): string {
  const withType = toVsCodeConfig(config)
  return `${scheme}:mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(JSON.stringify(withType))}`
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const MCP_CLIENTS: McpClientDef[] = [
  // ── Cursor ──────────────────────────────────────────────────────────────────
  {
    id: 'cursor',
    label: 'Cursor',
    description: 'One-click install into your project\'s .cursor/mcp.json',
    method: 'deeplink',
    transport: 'stdio',
    cliIde: 'cursor',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const config = buildStdioConfigObj(projectId, apiKey, endpoint, features)
      return { kind: 'deeplink', url: encodeCursorDeeplink(name, config) }
    },
  },

  // ── VS Code ──────────────────────────────────────────────────────────────────
  {
    id: 'vscode',
    label: 'VS Code',
    description: 'One-click install via VS Code MCP extension',
    method: 'deeplink',
    transport: 'stdio',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const config = buildStdioConfigObj(projectId, apiKey, endpoint, features)
      return { kind: 'deeplink', url: encodeVsCodeDeeplink('vscode', name, config) }
    },
  },

  // ── VS Code Insiders ─────────────────────────────────────────────────────────
  {
    id: 'vscode-insiders',
    label: 'VS Code Insiders',
    description: 'One-click install via VS Code Insiders MCP extension',
    method: 'deeplink',
    transport: 'stdio',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const config = buildStdioConfigObj(projectId, apiKey, endpoint, features)
      return { kind: 'deeplink', url: encodeVsCodeDeeplink('vscode-insiders', name, config) }
    },
  },

  // ── Windsurf ─────────────────────────────────────────────────────────────────
  {
    id: 'windsurf',
    label: 'Windsurf',
    description: 'Copy config into ~/.codeium/windsurf/mcp_config.json',
    method: 'config-json',
    transport: 'http',
    build({ projectId, projectName, apiKey, mcpHttpUrl, features, readOnly }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const url = withReadOnly(
        appendFeaturesToUrl(mcpHttpUrl, features ?? DEFAULT_FEATURE_GROUPS),
        readOnly,
      )
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'X-Mushi-Api-Key': apiKey,
      }
      if (projectId) headers['X-Mushi-Project-Id'] = projectId
      // Windsurf uses `serverUrl` (NOT `url`) — this is a common footgun.
      const windsurfConfig: WindsurfHttpConfig = { type: 'http', serverUrl: url, headers }
      const configJson = JSON.stringify(
        { mcpServers: { [name]: windsurfConfig } },
        null,
        2,
      )
      return {
        kind: 'config',
        filePath: '~/.codeium/windsurf/mcp_config.json',
        json: configJson,
      }
    },
  },

  // ── Cline ────────────────────────────────────────────────────────────────────
  {
    id: 'cline',
    label: 'Cline',
    description: 'Copy config into cline_mcp_settings.json',
    method: 'config-json',
    transport: 'stdio',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const env: Record<string, string> = {
        MUSHI_API_ENDPOINT: endpoint,
        MUSHI_API_KEY: apiKey,
      }
      if (features) env.MUSHI_FEATURES = featuresQueryString(features)
      if (projectId) env.MUSHI_PROJECT_ID = projectId
      const clineConfig = {
        mcpServers: {
          [name]: { command: 'npx', args: ['-y', MCP_PIN_SPEC], env },
        },
      }
      return {
        kind: 'config',
        // Cline stores config in the VS Code extension's globalStorage
        filePath: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
        json: JSON.stringify(clineConfig, null, 2),
      }
    },
  },

  // ── Claude Code ──────────────────────────────────────────────────────────────
  {
    id: 'claude-code',
    label: 'Claude Code',
    description: 'Add via claude CLI command (HTTP transport)',
    method: 'cli-command',
    transport: 'http',
    cliIde: 'claude',
    build({ projectId, projectName, apiKey, mcpHttpUrl, features, readOnly }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const url = withReadOnly(
        appendFeaturesToUrl(mcpHttpUrl, features ?? DEFAULT_FEATURE_GROUPS),
        readOnly,
      )
      const cmd = `claude mcp add --transport http ${name} "${url}" --header "Authorization: Bearer ${apiKey}"`
      return { kind: 'command', text: cmd }
    },
  },

  // ── Claude Desktop ───────────────────────────────────────────────────────────
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    description: 'Copy config into claude_desktop_config.json',
    method: 'config-json',
    transport: 'stdio',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const env: Record<string, string> = {
        MUSHI_API_ENDPOINT: endpoint,
        MUSHI_API_KEY: apiKey,
      }
      if (features) env.MUSHI_FEATURES = featuresQueryString(features)
      if (projectId) env.MUSHI_PROJECT_ID = projectId
      const desktopConfig = {
        mcpServers: {
          [name]: { command: 'npx', args: ['-y', MCP_PIN_SPEC], env },
        },
      }
      // macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
      // Windows: %APPDATA%\Claude\claude_desktop_config.json
      return {
        kind: 'config',
        filePath: '~/Library/Application Support/Claude/claude_desktop_config.json',
        json: JSON.stringify(desktopConfig, null, 2),
      }
    },
  },

  // ── Zed ──────────────────────────────────────────────────────────────────────
  {
    id: 'zed',
    label: 'Zed',
    description: 'Copy config into ~/.config/zed/settings.json',
    method: 'config-json',
    transport: 'stdio',
    cliIde: 'zed',
    build({ projectId, projectName, apiKey, endpoint, features }) {
      const name = projectId
        ? projectServerName(projectId, projectName)
        : `mushi-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`
      const env: Record<string, string> = {
        MUSHI_API_ENDPOINT: endpoint,
        MUSHI_API_KEY: apiKey,
      }
      if (features) env.MUSHI_FEATURES = featuresQueryString(features)
      if (projectId) env.MUSHI_PROJECT_ID = projectId
      const zedConfig = {
        context_servers: {
          [name]: {
            command: {
              path: 'npx',
              args: ['-y', MCP_PIN_SPEC],
              env,
            },
            settings: {},
          },
        },
      }
      return {
        kind: 'config',
        filePath: '~/.config/zed/settings.json',
        json: JSON.stringify(zedConfig, null, 2),
      }
    },
  },

  // ── Any MCP client ───────────────────────────────────────────────────────────
  {
    id: 'any',
    label: 'Any MCP client',
    description: 'Streamable HTTP URL — works with OpenClaw, Hermes, Gemini CLI, ChatGPT, and more',
    method: 'remote-url',
    transport: 'http',
    build({ projectId, apiKey, mcpHttpUrl, features, readOnly }) {
      const url = withReadOnly(
        appendFeaturesToUrl(mcpHttpUrl, features ?? DEFAULT_FEATURE_GROUPS),
        readOnly,
      )
      const headerSnippet = [
        `Authorization: Bearer ${apiKey}`,
        projectId ? `X-Mushi-Project-Id: ${projectId}` : '',
      ]
        .filter(Boolean)
        .join('\n')
      return { kind: 'remote-url', url, headerSnippet }
    },
  },
]

/** Look up a client by id — throws if not found. */
export function getMcpClient(id: McpClientId): McpClientDef {
  const client = MCP_CLIENTS.find((c) => c.id === id)
  if (!client) throw new Error(`Unknown MCP client id: ${id}`)
  return client
}

// ─── Re-export low-level helpers for consumers that build custom configs ─────

export { buildStdioConfigObj as buildRawStdioConfig, buildHttpConfigObj as buildRawHttpConfig }
