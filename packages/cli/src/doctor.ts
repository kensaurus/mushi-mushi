/**
 * `mushi doctor` — run pre-flight checks for the CLI and (optionally) the
 * Mushi backend. Mirrors the in-console dispatch preflight so devs can spot
 * setup gaps from the terminal without opening the admin UI.
 *
 * Extracted into its own module (matching the `nudge.ts` pattern) so the
 * logic can be unit-tested without spawning a child process.
 */

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
        : 'No endpoint in ~/.mushirc — run `mushi init` or `mushi config endpoint <url>`',
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
    // Config-file data intentionally used to probe the user's own endpoint.
    // lgtm[js/file-data-in-outbound-request]
    const res = await doFetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return {
      name: 'Endpoint reachable',
      ok: res.status === 200,
      detail: `GET ${endpoint}/health → ${res.status}`,
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
    // Config-file values (endpoint, projectId, apiKey) are intentionally
    // forwarded to the user's own server. lgtm[js/file-data-in-outbound-request]
    const res = await doFetch(
      `${config.endpoint}/v1/admin/projects/${config.projectId}/preflight`,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'X-Mushi-Api-Key': config.apiKey,
          'X-Mushi-Project': config.projectId,
        },
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
        detail: sc.hint,
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

  return { checks, ready: checks.every((c) => c.ok) }
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDoctorResult(result: DoctorResult): string {
  const PASS = '✓'
  const FAIL = '✗'
  const lines: string[] = []

  for (const c of result.checks) {
    lines.push(`${c.ok ? PASS : FAIL} ${c.name}`)
    lines.push(`  ${c.detail}`)
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
