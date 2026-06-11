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
   * the 4 dispatch-readiness checks. Requires apiKey + projectId + endpoint.
   */
  server?: boolean
  /**
   * When true, calls GET /v1/sync/ingest-setup for the 4 required ingest steps
   * (API key → SDK heartbeat → first report). Mutually composable with `server`.
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

// ── Main doctor runner ───────────────────────────────────────────────────────

export async function runDoctor(
  config: DoctorCliConfig,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const doFetch = options.fetch ?? globalThis.fetch
  const checks: DoctorCheck[] = []

  // 1. CLI config
  checks.push(...checkCliConfig(config))

  // 2. Endpoint reachability
  if (config.endpoint) {
    checks.push(await checkEndpointReachability(config.endpoint, doFetch))
  }

  // 3. SDK install
  const sdkCheck = await checkSdkInstall(options.cwd ?? process.cwd())
  if (sdkCheck) checks.push(sdkCheck)

  // 4. Server preflight (opt-in)
  if (options.server) {
    const serverChecks = await checkServerPreflight(config, doFetch)
    checks.push(...serverChecks)
  }

  // 5. Ingest setup (opt-in)
  if (options.ingest) {
    const ingestChecks = await checkIngestSetup(config, doFetch)
    checks.push(...ingestChecks)
  }

  // 6. QA story health (opt-in)
  if (options.qaStories) {
    const qaChecks = await checkQaStoriesHealth(config, doFetch)
    checks.push(...qaChecks)
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
