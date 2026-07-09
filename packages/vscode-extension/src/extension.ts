// SPDX-License-Identifier: MIT
/**
 * Mushi Mushi VS Code extension — registers the Mushi MCP server with VS Code
 * agent mode via the finalized `vscode.lm.registerMcpServerDefinitionProvider`
 * API (VS Code 1.101+).
 *
 * Config/env shapes mirror the canonical builders in
 * `packages/mcp/src/clients.ts` + `feature-groups.ts`. This extension is a
 * standalone Marketplace artifact (published via vsce/ovsx, not npm), so the
 * small shapes are inlined here rather than imported across the workspace —
 * keep them in sync with clients.ts.
 */
import * as vscode from 'vscode'

const PROVIDER_ID = 'mushiMushi'
const SECRET_KEY = 'mushiMushi.apiKey'
const SERVER_LABEL_STDIO = 'Mushi Mushi (npx)'
const SERVER_LABEL_HTTP = 'Mushi Mushi (hosted)'
const VERSION = '0.17.0'
// Pinned MCP npm spec — synced to packages/mcp/package.json by scripts/sync-mcp-pin.mjs.
const MCP_PIN_SPEC = '@mushi-mushi/mcp@0.19.0'
const DEFAULT_API = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api'
const DEFAULT_MCP = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp'

/** Feature subset the read-only demo is locked to (excludes write-heavy groups). */
const DEMO_FEATURES = 'triage,docs'

interface MushiConfig {
  transport: 'stdio' | 'http'
  endpoint: string
  mcpHttpUrl: string
  projectId: string
  features: string
  useDemo: boolean
  demoApiKey: string
}

function readConfig(): MushiConfig {
  const cfg = vscode.workspace.getConfiguration('mushiMushi')
  return {
    transport: cfg.get<'stdio' | 'http'>('transport', 'stdio'),
    endpoint: cfg.get<string>('endpoint', DEFAULT_API),
    mcpHttpUrl: cfg.get<string>('mcpHttpUrl', DEFAULT_MCP),
    projectId: cfg.get<string>('projectId', '').trim(),
    features: cfg.get<string>('features', 'triage,fixes,inventory,setup,docs').trim(),
    useDemo: cfg.get<boolean>('useDemo', false),
    demoApiKey: cfg.get<string>('demoApiKey', '').trim(),
  }
}

function effectiveFeatures(config: MushiConfig): string {
  return config.useDemo ? DEMO_FEATURES : config.features || 'triage,fixes,inventory,setup,docs'
}

function buildHttpUri(config: MushiConfig): vscode.Uri {
  const base = vscode.Uri.parse(config.mcpHttpUrl)
  const params = new URLSearchParams()
  params.set('features', effectiveFeatures(config))
  if (config.useDemo) params.set('read_only', '1')
  return base.with({ query: params.toString() })
}

function buildStdioEnv(config: MushiConfig, apiKey: string): Record<string, string> {
  const env: Record<string, string> = {
    MUSHI_API_ENDPOINT: config.endpoint,
    MUSHI_API_KEY: apiKey,
    MUSHI_FEATURES: effectiveFeatures(config),
  }
  if (config.projectId) env.MUSHI_PROJECT_ID = config.projectId
  return env
}

function buildHttpHeaders(config: MushiConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'X-Mushi-Api-Key': apiKey,
  }
  if (config.projectId) headers['X-Mushi-Project-Id'] = config.projectId
  return headers
}

/**
 * Build the definition for the configured transport. Key may be empty here —
 * the editor calls `provideMcpServerDefinitions` eagerly and we must not block
 * on user input. The real key is injected in `resolveMcpServerDefinition`.
 */
function buildDefinition(config: MushiConfig, apiKey: string): vscode.McpServerDefinition {
  if (config.transport === 'http') {
    return new vscode.McpHttpServerDefinition(
      SERVER_LABEL_HTTP,
      buildHttpUri(config),
      buildHttpHeaders(config, apiKey),
      VERSION,
    )
  }
  return new vscode.McpStdioServerDefinition(
    SERVER_LABEL_STDIO,
    'npx',
    ['-y', MCP_PIN_SPEC],
    buildStdioEnv(config, apiKey),
    VERSION,
  )
}

/** Resolve the API key without prompting (demo key or stored secret). */
async function peekApiKey(context: vscode.ExtensionContext, config: MushiConfig): Promise<string> {
  if (config.useDemo) return config.demoApiKey
  return (await context.secrets.get(SECRET_KEY)) ?? ''
}

/** Resolve the API key, prompting + persisting if needed. Returns '' on cancel. */
async function ensureApiKey(context: vscode.ExtensionContext, config: MushiConfig): Promise<string> {
  if (config.useDemo) {
    if (!config.demoApiKey) {
      void vscode.window.showErrorMessage(
        'Mushi Mushi: "Use demo" is on but no demo key is set. Set `mushiMushi.demoApiKey` or turn off the demo and add your own key.',
      )
    }
    return config.demoApiKey
  }

  const existing = await context.secrets.get(SECRET_KEY)
  if (existing) return existing

  const entered = await vscode.window.showInputBox({
    title: 'Mushi Mushi API key',
    prompt: 'Paste a Mushi MCP key (Console → Connect & Update → Add to VS Code). Leave empty to cancel.',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'mushi_...',
  })
  const trimmed = entered?.trim()
  if (!trimmed) return ''
  await context.secrets.store(SECRET_KEY, trimmed)
  return trimmed
}

export function activate(context: vscode.ExtensionContext): void {
  const didChange = new vscode.EventEmitter<void>()
  context.subscriptions.push(didChange)

  const provider: vscode.McpServerDefinitionProvider = {
    onDidChangeMcpServerDefinitions: didChange.event,
    provideMcpServerDefinitions: async () => {
      const config = readConfig()
      const apiKey = await peekApiKey(context, config)
      return [buildDefinition(config, apiKey)]
    },
    resolveMcpServerDefinition: async (server) => {
      const config = readConfig()
      const apiKey = await ensureApiKey(context, config)
      if (!apiKey) return undefined

      if (server instanceof vscode.McpStdioServerDefinition) {
        server.env = buildStdioEnv(config, apiKey)
      } else if (server instanceof vscode.McpHttpServerDefinition) {
        server.uri = buildHttpUri(config)
        server.headers = buildHttpHeaders(config, apiKey)
      }
      return server
    },
  }

  context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, provider))

  context.subscriptions.push(
    vscode.commands.registerCommand('mushiMushi.setApiKey', async () => {
      const entered = await vscode.window.showInputBox({
        title: 'Mushi Mushi API key',
        prompt: 'Paste a Mushi MCP key. Stored securely in VS Code SecretStorage.',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'mushi_...',
      })
      const trimmed = entered?.trim()
      if (!trimmed) return
      await context.secrets.store(SECRET_KEY, trimmed)
      didChange.fire()
      void vscode.window.showInformationMessage('Mushi Mushi: API key saved. Refresh MCP servers to connect.')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mushiMushi.clearApiKey', async () => {
      await context.secrets.delete(SECRET_KEY)
      didChange.fire()
      void vscode.window.showInformationMessage('Mushi Mushi: API key cleared.')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('mushiMushi.useDemo', async () => {
      await vscode.workspace
        .getConfiguration('mushiMushi')
        .update('useDemo', true, vscode.ConfigurationTarget.Global)
      didChange.fire()
      void vscode.window.showInformationMessage(
        'Mushi Mushi: read-only demo enabled. Refresh MCP servers to try it (no signup).',
      )
    }),
  )

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('mushiMushi')) didChange.fire()
    }),
  )
}

export function deactivate(): void {
  // no-op — subscriptions are disposed by VS Code via context.subscriptions
}
