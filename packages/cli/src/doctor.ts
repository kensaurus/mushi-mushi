/**
 * `mushi doctor` — run pre-flight checks for the CLI and (optionally) the
 * Mushi backend. Mirrors the in-console dispatch preflight so devs can spot
 * setup gaps from the terminal without opening the admin UI.
 *
 * Extracted into its own module (matching the `nudge.ts` pattern) so the
 * logic can be unit-tested without spawning a child process.
 */

import { fetchIngestSetup } from './heartbeat-wait.js'
import { apiKeyHeaders, sanitizeCliCredentials, sanitizeEndpoint } from './sanitize-config.js'

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

export interface DoctorResult {
  checks: DoctorCheck[]
  ready: boolean
}

export interface DoctorCliConfig {
  endpoint?: string
  apiKey?: string
  projectId?: string
}

export interface DoctorOptions {
  /** Path to detect SDK install in. Defaults to process.cwd(). */
  cwd?: string
  /**
   * When true, also calls the server's /preflight endpoint and includes
   * the 4 dispatch-readiness checks. Defaults to true — pass `server: false`
   * to skip when you only care about CLI wiring.
   */
  server?: boolean
  /**
   * When true, calls GET /v1/sync/ingest-setup for the 4 required ingest steps.
   * Defaults to true — pass `ingest: false` to skip.
   */
  ingest?: boolean
  /**
   * When true, queries the backend for enabled QA stories and flags:
   *   - firecrawl stories with no resolvable Firecrawl key
   *   - stories with no target URL
   *   - Slack unconfigured (no webhook or bot token)
   */
  qaStories?: boolean
  /**
   * When true, verify host-app wiring: env vars, MCP config, Capacitor hybrid notes.
   */
  hostApp?: boolean
  /**
   * When true, verify Cursor MCP config: checks .cursor/mcp.json for a mushi-*
   * server entry with valid credentials and probes the account-overview endpoint
   * to confirm the key can reach at least one project.
   */
  mcp?: boolean
  /**
   * Override the fetch implementation (for testing). Defaults to globalThis.fetch.
   */
  fetch?: typeof globalThis.fetch
}

// ── Check 1: CLI config sanity ───────────────────────────────────────────────

export function checkCliConfig(config: DoctorCliConfig): DoctorCheck[] {
  return [
    {
      name: 'CLI config file',
      ok: Boolean(config.endpoint),
      detail: config.endpoint
        ? `endpoint=${config.endpoint}`
        : 'No endpoint — set MUSHI_API_ENDPOINT, run `mushi connect`, or `mushi config endpoint <url>`',
    },
    {
      name: 'API key configured',
      ok: Boolean(config.apiKey),
      detail: config.apiKey
        ? `apiKey=${config.apiKey.slice(0, 8)}…${config.apiKey.slice(-4)}`
        : 'No API key set — run `mushi login --api-key <key>`',
    },
    {
      name: 'Project ID configured',
      ok: Boolean(config.projectId),
      detail: config.projectId
        ? `projectId=${config.projectId}`
        : 'No default project — set via `mushi config projectId <uuid>`',
    },
  ]
}

// ── Check 2: Endpoint reachability ───────────────────────────────────────────

export async function checkEndpointReachability(
  endpoint: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck> {
  try {
    const safeEndpoint = sanitizeEndpoint(endpoint)
    const res = await doFetch(`${safeEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return {
      name: 'Endpoint reachable',
      ok: res.status === 200,
      detail: `GET ${safeEndpoint}/health → ${res.status}`,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { name: 'Endpoint reachable', ok: false, detail: `Fetch failed: ${msg}` }
  }
}

// ── Check 3: SDK install detection ───────────────────────────────────────────

export async function checkSdkInstall(cwd: string): Promise<DoctorCheck | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { join, resolve } = await import('node:path')
    const root = resolve(cwd)
    const pkgPath = join(root, 'package.json')
    // Read directly — the catch block handles ENOENT. Skipping the
    // `access()` pre-check eliminates the TOCTOU race between check and read.
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    const sdks = [
      '@mushi-mushi/react',
      '@mushi-mushi/web',
      '@mushi-mushi/core',
      '@mushi-mushi/react-native',
    ]
    const installed = sdks.filter((s) => deps[s])
    return {
      name: 'SDK installed in this repo',
      ok: installed.length > 0,
      detail:
        installed.length > 0
          ? installed.map((s) => `${s}@${deps[s]}`).join(', ')
          : 'No @mushi-mushi/* package in package.json — run `mushi init` to install',
    }
  } catch {
    return null // Not a JS repo or no package.json — silently skip
  }
}

// ── Check 4: Server preflight ────────────────────────────────────────────────

export async function checkServerPreflight(
  config: DoctorCliConfig,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  if (!config.projectId || !config.apiKey || !config.endpoint) {
    return [
      {
        name: 'Server preflight',
        ok: false,
        detail:
          'Need projectId, apiKey, and endpoint. Run `mushi login` and `mushi config projectId <uuid>`.',
      },
    ]
  }

  try {
    const { endpoint, apiKey, projectId } = sanitizeCliCredentials(config)
    const res = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/preflight`,
      {
        headers: apiKeyHeaders(apiKey, projectId),
        signal: AbortSignal.timeout(8000),
      },
    )

    if (res.ok) {
      const body = (await res.json()) as {
        data?: {
          checks?: Array<{
            key: string
            ready: boolean
            label: string
            hint: string
          }>
        }
      }
      const serverChecks = body.data?.checks ?? []
      return serverChecks.map((sc) => ({
        name: `[server] ${sc.label}`,
        ok: sc.ready,
        detail: sc.ready ? '' : sc.hint,
      }))
    }

    const text = await res.text().catch(() => '')
    return [
      {
        name: 'Server preflight',
        ok: false,
        detail: `HTTP ${res.status}: ${text.slice(0, 120)}`,
      },
    ]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [{ name: 'Server preflight', ok: false, detail: `Fetch failed: ${msg}` }]
  }
}

// ── Check 5: Ingest setup (API key auth) ─────────────────────────────────────

export async function checkIngestSetup(
  config: DoctorCliConfig,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  if (!config.apiKey || !config.endpoint) {
    return [
      {
        name: 'Ingest setup',
        ok: false,
        detail: 'Need apiKey and endpoint. Run `mushi connect`.',
      },
    ]
  }

  try {
    const data = await fetchIngestSetup(
      { endpoint: config.endpoint, apiKey: config.apiKey, projectId: config.projectId },
      doFetch,
    )

    if (!data) {
      return [{ name: 'Ingest setup', ok: false, detail: 'Request to /v1/sync/ingest-setup failed or returned invalid payload' }]
    }

    const steps = data.steps ?? []
    const checks = steps
      .filter((s) => s.required)
      .map((s) => ({
        name: `[ingest] ${s.label}`,
        ok: s.complete,
        detail: s.complete ? '' : (s.hint ?? ''),
      }))

    const diag = data.diagnostic
    if (diag?.last_sdk_seen_at) {
      checks.push({
        name: '[ingest] Last SDK heartbeat',
        ok: true,
        detail: `${diag.last_sdk_seen_at}${diag.last_sdk_endpoint_host ? ` @ ${diag.last_sdk_endpoint_host}` : ''}`,
      })
    }

    return checks.length > 0 ? checks : [{ name: 'Ingest setup', ok: false, detail: 'Empty response from /v1/sync/ingest-setup' }]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [{ name: 'Ingest setup', ok: false, detail: `Fetch failed: ${msg}` }]
  }
}

// ── Check 6: QA story health ─────────────────────────────────────────────────

export async function checkQaStoriesHealth(
  config: DoctorCliConfig,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  if (!config.projectId || !config.apiKey || !config.endpoint) {
    return [
      {
        name: 'QA stories health',
        ok: false,
        detail: 'Need projectId, apiKey, and endpoint for QA story checks.',
      },
    ]
  }

  const checks: DoctorCheck[] = []

  try {
    const { endpoint, apiKey, projectId } = sanitizeCliCredentials(config)
    const headers = apiKeyHeaders(apiKey, projectId)

    // QA story list — the coverage endpoint is the canonical list surface and
    // is one of the few routes that accepts an API key (jwtOrApiKey), which is
    // how the CLI authenticates. There is no GET /qa-stories list route.
    const storiesRes = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/qa-coverage`,
      {
        headers,
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!storiesRes.ok) {
      checks.push({ name: '[qa] Fetch QA stories', ok: false, detail: `HTTP ${storiesRes.status}` })
      return checks
    }

    const storiesBody = (await storiesRes.json()) as {
      data?: {
        coverage?: Array<{
          story_id: string
          name: string
          enabled: boolean
          browser_provider?: string | null
        }>
      }
    }
    const stories = storiesBody.data?.coverage ?? []
    const enabled = stories.filter((s) => s.enabled)

    if (enabled.length === 0) {
      checks.push({ name: '[qa] Enabled QA stories', ok: true, detail: 'No enabled stories — create one at /qa-coverage' })
      return checks
    }

    checks.push({
      name: '[qa] Enabled QA stories',
      ok: true,
      detail: `${enabled.length} enabled story/stories configured`,
    })

    // Probe the Slack integration to warn if unconfigured
    const slackRes = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/integrations/probe/slack`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(6000),
      },
    )
    const slackBody = slackRes.ok ? (await slackRes.json() as { status?: string }) : null
    const slackOk = slackBody?.status === 'ok'
    checks.push({
      name: '[qa] Slack notifications configured',
      ok: slackOk,
      detail: slackOk
        ? 'Slack connected — failures will notify your channel'
        : 'Slack not connected — you won\'t be notified when stories fail. Visit /integrations → Add to Slack.',
    })

    // Probe Firecrawl key availability (via integration probe endpoint)
    const fcRes = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/integrations/probe/firecrawl`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(6000),
      },
    )
    const fcBody = fcRes.ok ? (await fcRes.json() as { status?: string }) : null
    const hasFirecrawlStories = enabled.some(
      (s) => !s.browser_provider || s.browser_provider === 'firecrawl_actions',
    )
    if (hasFirecrawlStories) {
      const fcOk = fcBody?.status === 'ok'
      checks.push({
        name: '[qa] Firecrawl API key configured',
        ok: fcOk,
        detail: fcOk
          ? 'Firecrawl key is resolvable — stories will run without Unauthorized errors'
          : 'No Firecrawl key found — enabled stories using firecrawl_actions will 401. Add a key at /integrations → BYOK keys.',
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    checks.push({ name: '[qa] QA stories health', ok: false, detail: `Fetch failed: ${msg}` })
  }

  return checks
}

// ── Check: Host app wiring (Vite/React/Capacitor) ───────────────────────────

export async function checkHostAppWiring(cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  try {
    const { readFile, access } = await import('node:fs/promises')
    const { join, resolve } = await import('node:path')
    const root = resolve(cwd)
    const pkgPath = join(root, 'package.json')
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    const isCapHybrid = Boolean(deps['@capacitor/core'] && deps['react'])

    const envCandidates = ['.env.local', '.env']
    let envContent = ''
    for (const f of envCandidates) {
      try {
        envContent = await readFile(join(root, f), 'utf8')
        break
      } catch { /* try next */ }
    }
    const hasProjectId = /VITE_MUSHI_PROJECT_ID=|NEXT_PUBLIC_MUSHI_PROJECT_ID=|MUSHI_PROJECT_ID=/.test(envContent)
    const hasApiKey = /VITE_MUSHI_API_KEY=|NEXT_PUBLIC_MUSHI_API_KEY=|MUSHI_API_KEY=/.test(envContent)
    checks.push({
      name: '[host] Mushi env vars in .env.local',
      ok: hasProjectId && hasApiKey,
      detail: hasProjectId && hasApiKey
        ? 'VITE_/MUSHI_ project id + API key found'
        : 'Run `mushi connect --write-env` or add VITE_MUSHI_PROJECT_ID + VITE_MUSHI_API_KEY',
    })

    let mcpPresent = false
    try {
      await access(join(root, '.cursor', 'mcp.json'))
      mcpPresent = true
    } catch { /* no mcp */ }
    checks.push({
      name: '[host] Cursor MCP config',
      ok: mcpPresent,
      detail: mcpPresent
        ? '.cursor/mcp.json present'
        : 'Run `mushi connect` to wire MCP for two-way reporter replies',
    })

    if (isCapHybrid) {
      const hasWebSdk = Boolean(deps['@mushi-mushi/web'] || deps['@mushi-mushi/react'])
      checks.push({
        name: '[host] Capacitor hybrid — WebView SDK',
        ok: hasWebSdk,
        detail: hasWebSdk
          ? 'Use @mushi-mushi/web or @mushi-mushi/react in the WebView (initMushi in main.tsx)'
          : 'Install @mushi-mushi/web for Capacitor WebView reporting',
      })
      checks.push({
        name: '[host] Capacitor native plugin (optional)',
        ok: true,
        detail: deps['@mushi-mushi/capacitor']
          ? `@mushi-mushi/capacitor@${deps['@mushi-mushi/capacitor']} installed`
          : 'Optional: @mushi-mushi/capacitor for native shell parity — WebView SDK covers most flows',
      })
    }
  } catch {
    checks.push({
      name: '[host] Host app detection',
      ok: false,
      detail: 'No package.json in cwd — run from your app repo root',
    })
  }
  return checks
}

// ── Check 8: MCP config health ───────────────────────────────────────────────

export async function checkMcpConfig(
  config: DoctorCliConfig,
  cwd: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = []
  const { readFile } = await import('node:fs/promises')
  const { join, resolve } = await import('node:path')
  const { homedir } = await import('node:os')
  const root = resolve(cwd)

  // 1. Find the mcp.json — check project-local first, then global ~/.cursor.
  // Read directly and let a missing file throw (caught below) rather than an
  // access()+readFile() pre-check, which is a TOCTOU race and an extra syscall.
  const candidates = [
    join(root, '.cursor', 'mcp.json'),
    join(homedir(), '.cursor', 'mcp.json'),
  ]
  let mcpPath: string | null = null
  let mcpRaw: string | null = null
  for (const candidate of candidates) {
    try {
      mcpRaw = await readFile(candidate, 'utf8')
      mcpPath = candidate
      break
    } catch { /* try next */ }
  }

  if (!mcpPath || !mcpRaw) {
    checks.push({
      name: '[mcp] mcp.json present',
      ok: false,
      detail: 'No .cursor/mcp.json found in cwd or ~/.cursor/. Run `mushi setup` to create it.',
    })
    return checks
  }
  checks.push({
    name: '[mcp] mcp.json present',
    ok: true,
    detail: `Found at ${mcpPath}`,
  })

  // 2. Parse and look for a mushi-* server entry
  let mcpConfig: { mcpServers?: Record<string, unknown> } = {}
  try {
    mcpConfig = JSON.parse(mcpRaw) as { mcpServers?: Record<string, unknown> }
  } catch {
    checks.push({ name: '[mcp] mcp.json valid JSON', ok: false, detail: 'mcp.json is not valid JSON — regenerate with `mushi setup`.' })
    return checks
  }

  const servers = mcpConfig.mcpServers ?? {}
  const mushiEntries = Object.entries(servers).filter(([k]) => k === 'mushi' || k.startsWith('mushi-'))
  if (mushiEntries.length === 0) {
    checks.push({
      name: '[mcp] mushi server entry',
      ok: false,
      detail: 'No mushi or mushi-* server found in mcpServers. Run `mushi setup` to add one.',
    })
    return checks
  }
  checks.push({
    name: '[mcp] mushi server entry',
    ok: true,
    detail: `Found: ${mushiEntries.map(([k]) => k).join(', ')}`,
  })

  // 3. Check each mushi entry for valid credentials
  let anyKeyValid = false
  let anyEndpointSet = false
  for (const [, srv] of mushiEntries) {
    const s = srv as { command?: string; args?: string[]; env?: Record<string, string> }
    const env = s.env ?? {}
    const key = env['MUSHI_API_KEY'] ?? ''
    const endpoint = env['MUSHI_API_ENDPOINT'] ?? ''
    if (key.startsWith('mushi_')) anyKeyValid = true
    if (endpoint.includes('supabase.co') || endpoint.includes('localhost')) anyEndpointSet = true
  }
  checks.push({
    name: '[mcp] MUSHI_API_KEY set',
    ok: anyKeyValid,
    detail: anyKeyValid
      ? 'At least one mushi server has a valid mushi_* API key'
      : 'No mushi_* API key found in any mushi server env. Re-run `mushi setup` to regenerate.',
  })
  checks.push({
    name: '[mcp] MUSHI_API_ENDPOINT set',
    ok: anyEndpointSet,
    detail: anyEndpointSet
      ? 'MUSHI_API_ENDPOINT is present and looks valid'
      : 'MUSHI_API_ENDPOINT missing or not a Supabase URL. Re-run `mushi setup`.',
  })

  // 4. Probe the API with the configured key to verify connectivity
  if (anyKeyValid && anyEndpointSet && config.apiKey && config.endpoint) {
    try {
      const { endpoint, apiKey } = sanitizeCliCredentials(config)
      const res = await doFetch(`${endpoint}/v1/admin/mcp/account-overview`, {
        headers: apiKeyHeaders(apiKey, config.projectId),
        signal: AbortSignal.timeout(6000),
      })
      if (res.ok) {
        const body = await res.json() as { ok?: boolean; data?: { total?: number } }
        const projectCount = body?.data?.total ?? 0
        checks.push({
          name: '[mcp] account-overview reachable',
          ok: true,
          detail: `Key is valid; ${projectCount} accessible project${projectCount === 1 ? '' : 's'}`,
        })
      } else {
        checks.push({
          name: '[mcp] account-overview reachable',
          ok: false,
          detail: `GET /v1/admin/mcp/account-overview → HTTP ${res.status}. Verify the API key is active.`,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      checks.push({
        name: '[mcp] account-overview reachable',
        ok: false,
        detail: `Probe failed: ${msg}. Check MUSHI_API_ENDPOINT and network connectivity.`,
      })
    }
  }

  return checks
}

// ── Fix hints — printed after each failed check so doctor always says HOW to fix ──

const FIX_HINTS: Record<string, string> = {
  'CLI config file': 'Run `mushi connect --endpoint <url> --project-id <uuid> --api-key mushi_xxx` or `mushi config endpoint <url>`.',
  'API key configured': 'Mint a key in the console (Projects → API Keys) then `mushi login --api-key mushi_xxx`.',
  'Project ID configured': 'Copy the project UUID from the console Projects page → `mushi config projectId <uuid>`.',
  'Endpoint reachable': 'Check your network and that MUSHI_API_ENDPOINT points at `…/functions/v1/api`.',
  '[ingest]': 'Open the console Onboarding wizard → Install SDK → submit a test report, or run `mushi connect --wait`.',
  '[server]': 'Open Settings → Integrations: connect GitHub, index codebase, add Anthropic BYOK key, enable autofix.',
  '[mcp]': 'Run `mushi setup` to regenerate .cursor/mcp.json with a fresh API key and endpoint.',
}

function fixHintForCheck(name: string): string | undefined {
  if (FIX_HINTS[name]) return FIX_HINTS[name]
  if (name.startsWith('[ingest]')) return FIX_HINTS['[ingest]']
  if (name.startsWith('[server]') || name.startsWith('[preflight]')) return FIX_HINTS['[server]']
  if (name.startsWith('[mcp]')) return FIX_HINTS['[mcp]']
  return undefined
}

// ── Main doctor runner ───────────────────────────────────────────────────────

export async function runDoctor(
  config: DoctorCliConfig,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const doFetch = options.fetch ?? globalThis.fetch
  const checks: DoctorCheck[] = []
  const runServer = options.server !== false
  const runIngest = options.ingest !== false

  // 1. CLI config
  checks.push(...checkCliConfig(config))

  // 2. Endpoint reachability
  if (config.endpoint) {
    checks.push(await checkEndpointReachability(config.endpoint, doFetch))
  }

  // 3. SDK install
  const sdkCheck = await checkSdkInstall(options.cwd ?? process.cwd())
  if (sdkCheck) checks.push(sdkCheck)

  // 4. Server preflight (on by default)
  if (runServer) {
    const serverChecks = await checkServerPreflight(config, doFetch)
    checks.push(...serverChecks)
  }

  // 5. Ingest setup (on by default)
  if (runIngest) {
    const ingestChecks = await checkIngestSetup(config, doFetch)
    checks.push(...ingestChecks)
  }

  // 6. QA story health (opt-in)
  if (options.qaStories) {
    const qaChecks = await checkQaStoriesHealth(config, doFetch)
    checks.push(...qaChecks)
  }

  // 7. Host app wiring (opt-in)
  if (options.hostApp) {
    const hostChecks = await checkHostAppWiring(options.cwd ?? process.cwd())
    checks.push(...hostChecks)
  }

  // 8. MCP config health (opt-in)
  if (options.mcp) {
    const mcpChecks = await checkMcpConfig(config, options.cwd ?? process.cwd(), doFetch)
    checks.push(...mcpChecks)
  }

  return { checks, ready: checks.every((c) => c.ok) }
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDoctorResult(result: DoctorResult): string {
  const PASS = '✓'
  const FAIL = '✗'
  const lines: string[] = []

  for (const c of result.checks) {
    lines.push(`${c.ok ? PASS : FAIL} ${c.name}`)
    if (c.detail) lines.push(`  ${c.detail}`)
    if (!c.ok) {
      const hint = fixHintForCheck(c.name)
      if (hint) lines.push(`  → Fix: ${hint}`)
    }
  }

  const failed = result.checks.filter((c) => !c.ok)
  if (failed.length === 0) {
    lines.push('\nAll checks passed. The CLI is ready.')
  } else {
    lines.push(`\n${failed.length} check${failed.length === 1 ? '' : 's'} failed.`)
    lines.push('Fix the items above and re-run `mushi doctor`.')
  }

  return lines.join('\n')
}
