/**
 * FILE: packages/mcp/src/stdio-config.ts
 * PURPOSE: Where the stdio binary's credentials come from, and what it says
 *          when there are none. Pure (no process access) so every branch is
 *          unit-tested; src/index.ts passes in `process.env` and the parsed
 *          CLI config.
 *
 *          A client that does not expand variables in its config hands the
 *          server the literal text `${MUSHI_API_KEY}`. That string used to be
 *          sent to the API as the key, and every tool failed with an auth
 *          error that never mentioned the config. A placeholder now counts as
 *          unset, and the setup-mode report names the client-side fix.
 */

/** What `mushi login` wrote, as read by src/index.ts. */
export interface CliConfigSnapshot {
  apiKey?: string
  projectId?: string
  endpoint?: string
  /** Absolute path that was checked — quoted verbatim in the report. */
  path: string
  /** True when the file existed and parsed (it may still lack an apiKey). */
  found: boolean
}

/** The env vars this binary reads credentials and routing from. */
type CredentialEnvVar = 'MUSHI_API_KEY' | 'MUSHI_PROJECT_ID' | 'MUSHI_API_ENDPOINT'

/**
 * True when `value` is a variable reference the MCP client passed through
 * unexpanded: `${VAR}`, `${env:VAR}`, `${input:id}`, `${VAR:-default}`,
 * `$VAR`, `%VAR%` or `{{VAR}}`. No Mushi key, UUID or URL has any of these
 * shapes, so a match is never a real value.
 */
function isUnexpandedPlaceholder(value: string): boolean {
  const v = value.trim()
  return (
    /^\$\{[^}]*\}$/.test(v) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v) ||
    /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(v) ||
    /^\{\{[^}]*\}\}$/.test(v)
  )
}

export interface ResolvedStdioCredentials {
  apiKey: string
  projectId: string
  endpoint: string
  /** Where the key came from — '' when there is none. */
  apiKeySource: 'env' | 'cli-config' | ''
  /** Env vars whose value was an unexpanded placeholder, with that literal value. */
  placeholders: Array<{ name: CredentialEnvVar; value: string }>
}

/**
 * Precedence: env var → CLI config → default. An empty env value falls
 * through (manifest configs use `${MUSHI_API_KEY:-}`, which expands to '' when
 * unset), and so does an unexpanded placeholder — it is never a usable value.
 */
export function resolveStdioCredentials(
  env: Readonly<Record<string, string | undefined>>,
  cli: CliConfigSnapshot,
  defaultEndpoint: string,
): ResolvedStdioCredentials {
  const placeholders: ResolvedStdioCredentials['placeholders'] = []
  const fromEnv = (name: CredentialEnvVar): string => {
    const raw = env[name]?.trim() ?? ''
    if (raw && isUnexpandedPlaceholder(raw)) {
      placeholders.push({ name, value: raw })
      return ''
    }
    return raw
  }
  const envKey = fromEnv('MUSHI_API_KEY')
  const envProject = fromEnv('MUSHI_PROJECT_ID')
  const envEndpoint = fromEnv('MUSHI_API_ENDPOINT')
  const cliKey = cli.apiKey?.trim() ?? ''
  return {
    apiKey: envKey || cliKey,
    projectId: envProject || cli.projectId?.trim() || '',
    endpoint: envEndpoint || cli.endpoint?.trim() || defaultEndpoint,
    apiKeySource: envKey ? 'env' : cliKey ? 'cli-config' : '',
    placeholders,
  }
}

/**
 * How to fix a placeholder, per client. Clients differ in the syntax they
 * expand, and one of them expands none, so the report names each.
 */
export function placeholderFixLines(placeholders: ResolvedStdioCredentials['placeholders']): string[] {
  if (placeholders.length === 0) return []
  return [
    '  Your MCP client did not expand the variable reference in its config, so the server',
    '  received the literal text instead of a value:',
    ...placeholders.map(({ name, value }) => `    ${name} = ${value}`),
    '',
    '  Fix it in the MCP client config (not in your shell):',
    '    • Claude Desktop does not expand variables — put the key itself in the "env" block.',
    '    • Cursor and VS Code expand ${env:MUSHI_API_KEY} (not ${MUSHI_API_KEY}).',
    '    • Claude Code expands ${MUSHI_API_KEY} in .mcp.json when it is set in the shell',
    '      that launched it.',
    '    • Or drop the variable from the "env" block and run `mushi login` — the server then',
    '      reads the key from the CLI config file that command writes.',
  ]
}

export interface MissingKeyReportInput {
  env: Readonly<Record<string, string | undefined>>
  cli: CliConfigSnapshot
  resolved: ResolvedStdioCredentials
}

/**
 * Everything an operator needs to fix a missing key, printed as one block on
 * stderr and returned by setup mode's diagnose_setup. It says WHICH file was
 * checked and WHERE the env block lives, so a config written under another
 * XDG root, a key set in the shell instead of the client's `env` block, a
 * file without an `apiKey` field, and an unexpanded `${…}` all read
 * differently in the client's log pane.
 */
export function missingApiKeyReport({ env, cli, resolved }: MissingKeyReportInput): string {
  const keyPlaceholder = resolved.placeholders.find((p) => p.name === 'MUSHI_API_KEY')
  const envState =
    env.MUSHI_API_KEY === undefined
      ? 'not set'
      : keyPlaceholder
        ? `set to the unexpanded placeholder ${keyPlaceholder.value}`
        : env.MUSHI_API_KEY.trim() === ''
          ? 'set but empty'
          : 'set'
  const cliState = !cli.found
    ? 'no file at this path'
    : cli.apiKey
      ? 'present'
      : 'file exists but has no "apiKey" field'
  const endpointEnv = env.MUSHI_API_ENDPOINT?.trim()
  const placeholderLines = placeholderFixLines(resolved.placeholders)
  return [
    '',
    '[mushi-mcp] No API key — serving setup mode: only search_mushi_docs, get_mushi_doc and',
    '            diagnose_setup are available until a key is configured.',
    '',
    '  Sources checked, in precedence order:',
    `    1. env MUSHI_API_KEY        → ${envState}`,
    `    2. CLI config file          → ${cliState}`,
    `       ${cli.path}`,
    '',
    ...(placeholderLines.length > 0 ? [...placeholderLines, ''] : []),
    '  Fix either one:',
    '    • Run `mushi login` (writes the config file above), or',
    '    • Add the key to the "env" block of your MCP client config',
    '      (.cursor/mcp.json · claude_desktop_config.json · .vscode/mcp.json):',
    '',
    '        { "mcpServers": { "mushi-mushi": {',
    '            "command": "npx", "args": ["-y", "@mushi-mushi/mcp"],',
    '            "env": { "MUSHI_API_KEY": "mushi_…", "MUSHI_PROJECT_ID": "<uuid>" } } } }',
    '',
    '      A key exported in your shell does NOT reach the server: MCP clients',
    '      spawn this process with only the env block they are given.',
    '',
    '  Other env vars this server reads:',
    `    MUSHI_API_ENDPOINT  ${endpointEnv && !isUnexpandedPlaceholder(endpointEnv) ? '= ' + endpointEnv : `unset → ${resolved.endpoint}`}`,
    `    MUSHI_PROJECT_ID    ${resolved.projectId ? '= ' + resolved.projectId : 'unset (account mode)'}`,
    '    MUSHI_SCOPES        optional CSV: mcp:read,mcp:write',
    '    MUSHI_FEATURES      optional CSV of tool groups, or "all"',
    '    MUSHI_MCP_TIMEOUT_MS  optional per-request timeout in ms (default 15000)',
    '',
    '  Mint a key: Console → Settings → API keys.',
    '',
  ].join('\n')
}
