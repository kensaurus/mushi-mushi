/**
 * FILE: packages/cli/src/version.ts
 * PURPOSE: Single source of truth for the CLI version at runtime.
 *
 * The bundler (tsup) replaces `__MUSHI_CLI_VERSION__` with the literal from
 * `package.json` at build time. Falling back to `'0.0.0-dev'` keeps
 * `tsc --noEmit` happy during development.
 */

declare const __MUSHI_CLI_VERSION__: string | undefined

export const MUSHI_CLI_VERSION: string =
  typeof __MUSHI_CLI_VERSION__ === 'string' ? __MUSHI_CLI_VERSION__ : '0.0.0-dev'

/**
 * Pinned npm spec for the MCP server written into persistent IDE configs
 * (mcp.json, Zed settings). Pinning avoids the supply-chain and cold-start
 * costs of `@latest` on every editor launch; `mushi upgrade` / re-running
 * setup refreshes the pin. Synced to packages/mcp/package.json by
 * `scripts/sync-mcp-pin.mjs` — never hand-edit the version.
 */
export const MUSHI_MCP_PIN_SPEC = '@mushi-mushi/mcp@0.19.0'
