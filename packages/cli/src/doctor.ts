/**
 * `mushi doctor` — run pre-flight checks for the CLI and (optionally) the
 * Mushi backend. Mirrors the in-console dispatch preflight so devs can spot
 * setup gaps from the terminal without opening the admin UI.
 *
 * Extracted into its own module (matching the `nudge.ts` pattern) so the
 * logic can be unit-tested without spawning a child process.
 */

import { fetchIngestSetup } from './heartbeat-wait.js';
import { apiKeyHeaders, sanitizeCliCredentials, sanitizeEndpoint } from './sanitize-config.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /**
   * When true the check is shown with ⚠ instead of ✗ and does not count
   * against `ready`. Use for informational gaps that don't block functionality
   * (e.g. "SDK not installed in cwd" when heartbeats prove it's working).
   */
  warn?: boolean;
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  ready: boolean;
}

export interface DoctorCliConfig {
  endpoint?: string;
  apiKey?: string;
  projectId?: string;
}

export interface DoctorOptions {
  /** Path to detect SDK install in. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * When true, also calls the server's /preflight endpoint and includes
   * the 4 dispatch-readiness checks. Defaults to true — pass `server: false`
   * to skip when you only care about CLI wiring.
   */
  server?: boolean;
  /**
   * When true, calls GET /v1/sync/ingest-setup for the 4 required ingest steps.
   * Defaults to true — pass `ingest: false` to skip.
   */
  ingest?: boolean;
  /**
   * When true, queries the backend for enabled QA stories and flags:
   *   - firecrawl stories with no resolvable Firecrawl key
   *   - stories with no target URL
   *   - Slack unconfigured (no webhook or bot token)
   */
  qaStories?: boolean;
  /**
   * When true, verify host-app wiring: env vars, MCP config, Capacitor hybrid notes.
   */
  hostApp?: boolean;
  /**
   * When true, diagnose the browser sign-in (device-auth) handshake: route
   * reachability, clock skew, saved-credential validity. Use after a failed
   * `npx mushi-mushi` browser sign-in.
   */
  auth?: boolean;
  /**
   * When true, verify Cursor MCP config: checks .cursor/mcp.json for a mushi-*
   * server entry with valid credentials and probes the account-overview endpoint
   * to confirm the key can reach at least one project.
   */
  mcp?: boolean;
  /**
   * When true, run a focused onboarding-mode check: TTY hints, config, env vars,
   * ingest steps, and pending browser auth. Prints the single next blocking action
   * with a console deep link instead of a full check table.
   */
  onboarding?: boolean;
  /**
   * When true, run ALL checks (server, ingest, host-app, mcp, qa-stories) in one
   * shot. Overrides individual flags. Prints a structured grouped table with
   * pass/fail counts per category. Good for first-run diagnostics.
   */
  full?: boolean;
  /**
   * Override the fetch implementation (for testing). Defaults to globalThis.fetch.
   */
  fetch?: typeof globalThis.fetch;
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
  ];
}

// ── Check 2: Endpoint reachability ───────────────────────────────────────────

export async function checkEndpointReachability(
  endpoint: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck> {
  try {
    const safeEndpoint = sanitizeEndpoint(endpoint);
    const res = await doFetch(`${safeEndpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return {
      name: 'Endpoint reachable',
      ok: res.status === 200,
      detail: `GET ${safeEndpoint}/health → ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'Endpoint reachable', ok: false, detail: `Fetch failed: ${msg}` };
  }
}

// ── Check 2b: browser sign-in (device-auth) path ─────────────────────────────

/**
 * `mushi doctor --auth` — diagnose the browser sign-in handshake after a
 * failed `npx mushi-mushi` wizard run. Three checks, none of which create
 * server-side state (a real /device/start would burn a rate-limited session):
 *
 * 1. Device-token route reachability: POST a bogus device_code and expect a
 *    definitive JSON error. A 4xx here PROVES the route is deployed and
 *    responding; only a network error / 5xx fails the check.
 * 2. Clock skew vs the server's Date header — device codes are short-lived,
 *    so a badly skewed local clock can expire every code instantly.
 * 3. Saved CLI credentials validity via /v1/sync/whoami (warn-only when no
 *    credentials are saved yet — that's normal before first sign-in).
 */
export async function checkCliAuthPath(
  config: DoctorCliConfig,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  if (!config.endpoint) {
    return [
      {
        name: 'Sign-in route reachable',
        ok: false,
        detail: 'No endpoint configured — run `npx mushi-mushi` or pass MUSHI_API_ENDPOINT.',
      },
    ];
  }
  const base = sanitizeEndpoint(config.endpoint);

  let dateHeader: string | null = null;
  try {
    const res = await doFetch(`${base}/v1/cli/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'doctor-probe' }),
      signal: AbortSignal.timeout(8000),
    });
    dateHeader = res.headers?.get?.('date') ?? null;
    const signInRouteReachable = res.status === 400 || res.status === 429;
    checks.push({
      name: 'Sign-in route reachable',
      ok: signInRouteReachable,
      detail: signInRouteReachable
        ? `POST ${base}/v1/cli/auth/device/token → ${res.status} (route deployed and answering)`
        : `POST ${base}/v1/cli/auth/device/token → ${res.status} — expected HTTP 400 (invalid device_code) or 429 (slow_down); the API may be down or mis-deployed.`,
    });
  } catch (err) {
    checks.push({
      name: 'Sign-in route reachable',
      ok: false,
      detail: `Fetch failed: ${err instanceof Error ? err.message : String(err)} — check network/proxy/firewall to ${base}.`,
    });
  }

  if (dateHeader) {
    const serverMs = Date.parse(dateHeader);
    if (!Number.isNaN(serverMs)) {
      const skewSec = Math.round(Math.abs(Date.now() - serverMs) / 1000);
      const ok = skewSec <= 120;
      checks.push({
        name: 'System clock in sync',
        ok,
        warn: !ok && skewSec <= 300,
        detail: ok
          ? `Local clock within ${skewSec}s of the server.`
          : `Local clock is ${skewSec}s off the server — sign-in codes expire fast; fix your system time.`,
      });
    }
  }

  if (config.apiKey && config.projectId) {
    try {
      const res = await doFetch(`${base}/v1/sync/whoami`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...apiKeyHeaders(config.apiKey, config.projectId),
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(8000),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { project_name?: string };
        error?: { message?: string };
      } | null;
      const ok = res.ok && json?.ok === true;
      checks.push({
        name: 'Saved credentials valid',
        ok,
        detail: ok
          ? `API key resolves to project "${json?.data?.project_name ?? config.projectId}".`
          : `${json?.error?.message ?? `whoami → HTTP ${res.status}`} — re-run \`npx mushi-mushi\` to sign in again.`,
      });
    } catch (err) {
      checks.push({
        name: 'Saved credentials valid',
        ok: false,
        detail: `whoami fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    checks.push({
      name: 'Saved credentials valid',
      ok: true,
      warn: true,
      detail: 'No saved CLI credentials yet — normal before the first successful sign-in.',
    });
  }

  return checks;
}

// ── Check 3: SDK install detection ───────────────────────────────────────────

export async function checkSdkInstall(cwd: string): Promise<DoctorCheck | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const root = resolve(cwd);
    const pkgPath = join(root, 'package.json');
    // Read directly — the catch block handles ENOENT. Skipping the
    // `access()` pre-check eliminates the TOCTOU race between check and read.
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const sdks = [
      '@mushi-mushi/react',
      '@mushi-mushi/web',
      '@mushi-mushi/core',
      '@mushi-mushi/react-native',
    ];
    const installed = sdks.filter((s) => deps[s]);
    return {
      name: 'SDK installed in this repo',
      ok: installed.length > 0,
      detail:
        installed.length > 0
          ? installed.map((s) => `${s}@${deps[s]}`).join(', ')
          : 'No @mushi-mushi/* package in package.json — run `mushi init` to install',
    };
  } catch {
    return null; // Not a JS repo or no package.json — silently skip
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
    ];
  }

  try {
    const { endpoint, apiKey, projectId } = sanitizeCliCredentials(config);
    const res = await doFetch(`${endpoint}/v1/admin/projects/${projectId}/preflight`, {
      headers: apiKeyHeaders(apiKey, projectId),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const body = (await res.json()) as {
        data?: {
          checks?: Array<{
            key: string;
            ready: boolean;
            label: string;
            hint: string;
          }>;
        };
      };
      const serverChecks = body.data?.checks ?? [];
      return serverChecks.map((sc) => ({
        name: `[server] ${sc.label}`,
        ok: sc.ready,
        detail: sc.ready ? '' : sc.hint,
      }));
    }

    if (res.status === 403) {
      // Wizard-minted keys now include mcp:read, but older ingest-only keys cannot
      // call the preflight endpoint. Treat as a skipped (non-fatal) check with a
      // clear upgrade hint rather than a hard failure.
      let errCode: string | undefined;
      try {
        const body = (await res.json()) as { error?: { code?: string } };
        errCode = body?.error?.code;
      } catch {
        /* ignore */
      }
      if (errCode === 'INSUFFICIENT_SCOPE') {
        return [
          {
            name: 'Server preflight',
            ok: true,
            detail:
              'Skipped — your key has report:write scope only (pre-Jun 2026 key). ' +
              'Run `mushi login --upgrade-scope` to get mcp:read and run admin checks.',
          },
        ];
      }
    }

    const text = await res.text().catch(() => '');
    return [
      {
        name: 'Server preflight',
        ok: false,
        detail: `HTTP ${res.status}: ${text.slice(0, 120)}`,
      },
    ];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ name: 'Server preflight', ok: false, detail: `Fetch failed: ${msg}` }];
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
    ];
  }

  try {
    const data = await fetchIngestSetup(
      { endpoint: config.endpoint, apiKey: config.apiKey, projectId: config.projectId },
      doFetch,
    );

    if (!data) {
      return [
        {
          name: 'Ingest setup',
          ok: false,
          detail: 'Request to /v1/sync/ingest-setup failed or returned invalid payload',
        },
      ];
    }

    const steps = data.steps ?? [];
    const checks = steps
      .filter((s) => s.required)
      .map((s) => ({
        name: `[ingest] ${s.label}`,
        ok: s.complete,
        detail: s.complete ? '' : (s.hint ?? ''),
      }));

    const diag = data.diagnostic;
    if (diag?.last_sdk_seen_at) {
      checks.push({
        name: '[ingest] Last SDK heartbeat',
        ok: true,
        detail: `${diag.last_sdk_seen_at}${diag.last_sdk_endpoint_host ? ` @ ${diag.last_sdk_endpoint_host}` : ''}`,
      });
    }

    return checks.length > 0
      ? checks
      : [{ name: 'Ingest setup', ok: false, detail: 'Empty response from /v1/sync/ingest-setup' }];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return [{ name: 'Ingest setup', ok: false, detail: `Fetch failed: ${msg}` }];
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
    ];
  }

  const checks: DoctorCheck[] = [];

  try {
    const { endpoint, apiKey, projectId } = sanitizeCliCredentials(config);
    const headers = apiKeyHeaders(apiKey, projectId);

    // QA story list — the coverage endpoint is the canonical list surface and
    // is one of the few routes that accepts an API key (jwtOrApiKey), which is
    // how the CLI authenticates. There is no GET /qa-stories list route.
    const storiesRes = await doFetch(`${endpoint}/v1/admin/projects/${projectId}/qa-coverage`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (!storiesRes.ok) {
      checks.push({
        name: '[qa] Fetch QA stories',
        ok: false,
        detail: `HTTP ${storiesRes.status}`,
      });
      return checks;
    }

    const storiesBody = (await storiesRes.json()) as {
      data?: {
        coverage?: Array<{
          story_id: string;
          name: string;
          enabled: boolean;
          browser_provider?: string | null;
        }>;
      };
    };
    const stories = storiesBody.data?.coverage ?? [];
    const enabled = stories.filter((s) => s.enabled);

    if (enabled.length === 0) {
      checks.push({
        name: '[qa] Enabled QA stories',
        ok: true,
        detail: 'No enabled stories — create one at /qa-coverage',
      });
      return checks;
    }

    checks.push({
      name: '[qa] Enabled QA stories',
      ok: true,
      detail: `${enabled.length} enabled story/stories configured`,
    });

    // Probe the Slack integration to warn if unconfigured
    const slackRes = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/integrations/probe/slack`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(6000),
      },
    );
    const slackBody = slackRes.ok ? ((await slackRes.json()) as { status?: string }) : null;
    const slackOk = slackBody?.status === 'ok';
    checks.push({
      name: '[qa] Slack notifications configured',
      ok: slackOk,
      detail: slackOk
        ? 'Slack connected — failures will notify your channel'
        : "Slack not connected — you won't be notified when stories fail. Visit /integrations → Add to Slack.",
    });

    // Probe Firecrawl key availability (via integration probe endpoint)
    const fcRes = await doFetch(
      `${endpoint}/v1/admin/projects/${projectId}/integrations/probe/firecrawl`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(6000),
      },
    );
    const fcBody = fcRes.ok ? ((await fcRes.json()) as { status?: string }) : null;
    const hasFirecrawlStories = enabled.some(
      (s) => !s.browser_provider || s.browser_provider === 'firecrawl_actions',
    );
    if (hasFirecrawlStories) {
      const fcOk = fcBody?.status === 'ok';
      checks.push({
        name: '[qa] Firecrawl API key configured',
        ok: fcOk,
        detail: fcOk
          ? 'Firecrawl key is resolvable — stories will run without Unauthorized errors'
          : 'No Firecrawl key found — enabled stories using firecrawl_actions will 401. Add a key at /integrations → BYOK keys.',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    checks.push({ name: '[qa] QA stories health', ok: false, detail: `Fetch failed: ${msg}` });
  }

  return checks;
}

// ── Check: Host app wiring (Vite/React/Capacitor) ───────────────────────────

export async function checkHostAppWiring(cwd: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const { readFile, access } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const root = resolve(cwd);
    const pkgPath = join(root, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const isCapHybrid = Boolean(deps['@capacitor/core'] && deps['react']);

    const envCandidates = ['.env.local', '.env'];
    let envContent = '';
    for (const f of envCandidates) {
      try {
        envContent = await readFile(join(root, f), 'utf8');
        break;
      } catch {
        /* try next */
      }
    }
    const hasProjectId =
      /VITE_MUSHI_PROJECT_ID=|NEXT_PUBLIC_MUSHI_PROJECT_ID=|MUSHI_PROJECT_ID=/.test(envContent);
    const hasApiKey = /VITE_MUSHI_API_KEY=|NEXT_PUBLIC_MUSHI_API_KEY=|MUSHI_API_KEY=/.test(
      envContent,
    );
    checks.push({
      name: '[host] Mushi env vars in .env.local',
      ok: hasProjectId && hasApiKey,
      detail:
        hasProjectId && hasApiKey
          ? 'VITE_/MUSHI_ project id + API key found'
          : 'Run `mushi connect --write-env` or add VITE_MUSHI_PROJECT_ID + VITE_MUSHI_API_KEY',
    });

    let mcpPresent = false;
    try {
      await access(join(root, '.cursor', 'mcp.json'));
      mcpPresent = true;
    } catch {
      /* no mcp */
    }
    checks.push({
      name: '[host] Cursor MCP config',
      ok: mcpPresent,
      detail: mcpPresent
        ? '.cursor/mcp.json present'
        : 'Run `mushi connect` to wire MCP for two-way reporter replies',
    });

    if (isCapHybrid) {
      const hasWebSdk = Boolean(deps['@mushi-mushi/web'] || deps['@mushi-mushi/react']);
      checks.push({
        name: '[host] Capacitor hybrid — WebView SDK',
        ok: hasWebSdk,
        detail: hasWebSdk
          ? 'Use @mushi-mushi/web or @mushi-mushi/react in the WebView (initMushi in main.tsx)'
          : 'Install @mushi-mushi/web for Capacitor WebView reporting',
      });
      checks.push({
        name: '[host] Capacitor native plugin (optional)',
        ok: true,
        detail: deps['@mushi-mushi/capacitor']
          ? `@mushi-mushi/capacitor@${deps['@mushi-mushi/capacitor']} installed`
          : 'Optional: @mushi-mushi/capacitor for native shell parity — WebView SDK covers most flows',
      });
    }
  } catch {
    checks.push({
      name: '[host] Host app detection',
      ok: false,
      detail: 'No package.json in cwd — run from your app repo root',
    });
  }
  return checks;
}

// ── Check 8: MCP config health ───────────────────────────────────────────────

export async function checkMcpConfig(
  config: DoctorCliConfig,
  cwd: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const { readFile } = await import('node:fs/promises');
  const { join, resolve } = await import('node:path');
  const { homedir } = await import('node:os');
  const root = resolve(cwd);

  // 1. Find the mcp.json — check project-local first, then global ~/.cursor.
  // Read directly and let a missing file throw (caught below) rather than an
  // access()+readFile() pre-check, which is a TOCTOU race and an extra syscall.
  // Skip a candidate if it exists but has an empty mcpServers object (e.g. a
  // project-local stub that redirects users to the global config). This prevents
  // the doctor from stopping at an empty file and missing the real global entry.
  const candidates = [join(root, '.cursor', 'mcp.json'), join(homedir(), '.cursor', 'mcp.json')];
  let mcpPath: string | null = null;
  let mcpRaw: string | null = null;
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      // Peek at mcpServers: if this file is a stub with no entries, try the next
      // candidate rather than stopping here with a false-negative failure.
      let parsed: { mcpServers?: Record<string, unknown> } = {};
      try {
        parsed = JSON.parse(raw) as typeof parsed;
      } catch {
        /* malformed — still use this file */
      }
      const hasEntries = Object.keys(parsed.mcpServers ?? {}).length > 0;
      if (!hasEntries && candidates.indexOf(candidate) < candidates.length - 1) {
        // This file is empty/stub — continue to the next candidate.
        continue;
      }
      mcpRaw = raw;
      mcpPath = candidate;
      break;
    } catch {
      /* try next */
    }
  }

  if (!mcpPath || !mcpRaw) {
    checks.push({
      name: '[mcp] mcp.json present',
      ok: false,
      detail: 'No .cursor/mcp.json found in cwd or ~/.cursor/. Run `mushi setup` to create it.',
    });
    return checks;
  }
  checks.push({
    name: '[mcp] mcp.json present',
    ok: true,
    detail: `Found at ${mcpPath}`,
  });

  // 2. Parse and look for a mushi-* server entry
  let mcpConfig: { mcpServers?: Record<string, unknown> } = {};
  try {
    mcpConfig = JSON.parse(mcpRaw) as { mcpServers?: Record<string, unknown> };
  } catch {
    checks.push({
      name: '[mcp] mcp.json valid JSON',
      ok: false,
      detail: 'mcp.json is not valid JSON — regenerate with `mushi setup`.',
    });
    return checks;
  }

  const servers = mcpConfig.mcpServers ?? {};
  const mushiEntries = Object.entries(servers).filter(
    ([k]) => k === 'mushi' || k.startsWith('mushi-'),
  );
  if (mushiEntries.length === 0) {
    checks.push({
      name: '[mcp] mushi server entry',
      ok: false,
      detail: 'No mushi or mushi-* server found in mcpServers. Run `mushi setup` to add one.',
    });
    return checks;
  }
  checks.push({
    name: '[mcp] mushi server entry',
    ok: true,
    detail: `Found: ${mushiEntries.map(([k]) => k).join(', ')}`,
  });

  // 3. Check each mushi entry for valid credentials
  let anyKeyValid = false;
  let anyEndpointSet = false;
  for (const [, srv] of mushiEntries) {
    const s = srv as { command?: string; args?: string[]; env?: Record<string, string> };
    const env = s.env ?? {};
    const key = env['MUSHI_API_KEY'] ?? '';
    const endpoint = env['MUSHI_API_ENDPOINT'] ?? '';
    if (key.startsWith('mushi_')) anyKeyValid = true;
    if (endpoint.includes('supabase.co') || endpoint.includes('localhost')) anyEndpointSet = true;
  }
  checks.push({
    name: '[mcp] MUSHI_API_KEY set',
    ok: anyKeyValid,
    detail: anyKeyValid
      ? 'At least one mushi server has a valid mushi_* API key'
      : 'No mushi_* API key found in any mushi server env. Re-run `mushi setup` to regenerate.',
  });
  checks.push({
    name: '[mcp] MUSHI_API_ENDPOINT set',
    ok: anyEndpointSet,
    detail: anyEndpointSet
      ? 'MUSHI_API_ENDPOINT is present and looks valid'
      : 'MUSHI_API_ENDPOINT missing or not a Supabase URL. Re-run `mushi setup`.',
  });

  // 4. Probe the API with the configured key to verify connectivity
  if (anyKeyValid && anyEndpointSet && config.apiKey && config.endpoint) {
    try {
      const { endpoint, apiKey } = sanitizeCliCredentials(config);
      const res = await doFetch(`${endpoint}/v1/admin/mcp/account-overview`, {
        headers: apiKeyHeaders(apiKey, config.projectId),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; data?: { total?: number } };
        const projectCount = body?.data?.total ?? 0;
        checks.push({
          name: '[mcp] account-overview reachable',
          ok: true,
          detail: `Key is valid; ${projectCount} accessible project${projectCount === 1 ? '' : 's'}`,
        });
      } else {
        // Try to extract a structured error code from the body for better hints.
        let detail = `GET /v1/admin/mcp/account-overview → HTTP ${res.status}. Verify the API key is active.`;
        try {
          const errBody = (await res.json()) as Record<string, unknown>;
          const nested = errBody['error'] as Record<string, unknown> | undefined;
          const errCode = (nested?.['code'] as string) ?? (errBody['code'] as string) ?? '';
          if (errCode === 'INSUFFICIENT_SCOPE') {
            detail = `Key has report:write scope only — run \`mushi login --upgrade-scope\` then \`mushi setup\` to get mcp:read.`;
          }
        } catch {
          /* ignore parse errors */
        }
        checks.push({
          name: '[mcp] account-overview reachable',
          ok: false,
          detail,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        name: '[mcp] account-overview reachable',
        ok: false,
        detail: `Probe failed: ${msg}. Check MUSHI_API_ENDPOINT and network connectivity.`,
      });
    }
  }

  return checks;
}

// ── Fix hints — printed after each failed check so doctor always says HOW to fix ──

const FIX_HINTS: Record<string, string> = {
  'CLI config file':
    'Run `mushi connect --endpoint <url> --project-id <uuid> --api-key mushi_xxx` or `mushi config endpoint <url>`.',
  'API key configured':
    'Mint a key in the console (Projects → API Keys) then `mushi login --api-key mushi_xxx`.',
  'Project ID configured':
    'Copy the project UUID from the console Projects page → `mushi config projectId <uuid>`.',
  'Endpoint reachable':
    'Check your network and that MUSHI_API_ENDPOINT points at `…/functions/v1/api`.',
  '[ingest]':
    'Open the console Onboarding wizard → Install SDK → submit a test report, or run `mushi connect --wait`.',
  '[server]':
    'Open Settings → Integrations: connect GitHub, index codebase, add Anthropic BYOK key, enable autofix.',
  '[mcp]': 'Run `mushi setup` to regenerate .cursor/mcp.json with a fresh API key and endpoint.',
};

export function fixHintForCheck(name: string): string | undefined {
  if (FIX_HINTS[name]) return FIX_HINTS[name];
  if (name.startsWith('[ingest]')) return FIX_HINTS['[ingest]'];
  if (name.startsWith('[server]') || name.startsWith('[preflight]')) return FIX_HINTS['[server]'];
  if (name.startsWith('[mcp]')) return FIX_HINTS['[mcp]'];
  return undefined;
}

// ── Onboarding mode: single-next-action ─────────────────────────────────────

export interface OnboardingStatus {
  /** A one-liner describing what the developer should do right now. */
  nextAction: string;
  /** Console deep-link for the next action (absolute path, e.g. /onboarding?tab=sdk). */
  ctaPath: string;
  /** True when all 4 required setup steps are complete. */
  done: boolean;
}

export async function checkOnboardingStatus(
  config: DoctorCliConfig,
  _consoleBase: string,
  cwd: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Promise<OnboardingStatus> {
  // Step 1: API key + project must be configured before anything else
  if (!config.apiKey || !config.projectId || !config.endpoint) {
    // Check whether there is a pending CLI auth request the user may have missed
    if (config.apiKey && config.endpoint) {
      // Key exists but no project — might just need project selection
      return {
        nextAction:
          'Select or create a project: run `mushi project create` or pick one with `mushi project list`',
        ctaPath: '/onboarding?tab=steps&setup=cli',
        done: false,
      };
    }
    return {
      nextAction:
        'Sign in to Mushi: run `npx mushi-mushi` (browser opens automatically — do NOT type the code in the terminal)',
      ctaPath: '/onboarding?tab=steps&setup=cli',
      done: false,
    };
  }

  // Step 2: Check env vars in the app directory
  try {
    const { readFile } = await import('node:fs/promises');
    const { join, resolve } = await import('node:path');
    const root = resolve(cwd);
    let envContent = '';
    for (const f of ['.env.local', '.env']) {
      try {
        envContent = await readFile(join(root, f), 'utf8');
        break;
      } catch {
        /* try next */
      }
    }
    const hasEnvVars = /(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_)?MUSHI_PROJECT_ID=/.test(
      envContent,
    );
    if (!hasEnvVars) {
      return {
        nextAction:
          'Write env vars to your app: run `npx mushi-mushi` or `mushi connect --write-env`',
        ctaPath: '/onboarding?tab=sdk',
        done: false,
      };
    }
  } catch {
    /* Not a JS repo — skip env check */
  }

  // Step 3: SDK install check
  try {
    const sdkCheck = await checkSdkInstall(cwd);
    if (sdkCheck && !sdkCheck.ok) {
      return {
        nextAction: `Install the Mushi SDK: ${sdkCheck.detail}`,
        ctaPath: '/onboarding?tab=sdk',
        done: false,
      };
    }
  } catch {
    /* skip */
  }

  // Step 4: Ingest setup — find the first incomplete required step
  try {
    const data = await fetchIngestSetup(
      { endpoint: config.endpoint, apiKey: config.apiKey, projectId: config.projectId },
      doFetch,
    );
    if (data) {
      const steps = data.steps ?? [];
      const incomplete = steps.find((s) => s.required && !s.complete);
      if (incomplete) {
        const tabMap: Record<string, string> = {
          project_created: '/onboarding?tab=steps&setup=cli',
          api_key_generated: '/onboarding?tab=verify',
          sdk_installed: '/onboarding?tab=sdk',
          first_report_received: '/onboarding?tab=verify',
        };
        const tab = tabMap[incomplete.id] ?? '/onboarding?tab=verify';
        return {
          nextAction: incomplete.hint ?? `Complete setup step: ${incomplete.label}`,
          ctaPath: tab,
          done: false,
        };
      }
      return {
        nextAction: 'All 4 required setup steps are complete! Open the console to explore.',
        ctaPath: '/reports',
        done: true,
      };
    }
  } catch {
    /* network error — fall through */
  }

  return {
    nextAction: 'Open the onboarding wizard in the console to check your setup status.',
    ctaPath: '/onboarding',
    done: false,
  };
}

// ── Version drift (headroom pattern: stale tooling is a silent failure) ─────

/**
 * Advisory check comparing the running CLI against the npm `latest` tag and
 * against `@mushi-mushi/*` SDK versions in the target repo. Never blocks
 * `ready`; a registry timeout silently skips (no network ≠ broken setup).
 */
export async function checkVersionDrift(
  cwd: string,
  doFetch: typeof fetch,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const { MUSHI_CLI_VERSION } = await import('./version.js');
  if (MUSHI_CLI_VERSION === '0.0.0-dev') return checks;

  // Full-precision semver compare: every published package is still 0.x, so a
  // majors-only comparison would never fire for anything that exists today.
  const parse = (v: string): [number, number, number] => {
    const m = v.replace(/^[~^]/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  };
  const isBehind = (installed: string, latest: string): boolean => {
    const [a1, a2, a3] = parse(installed);
    const [b1, b2, b3] = parse(latest);
    return a1 !== b1 ? a1 < b1 : a2 !== b2 ? a2 < b2 : a3 < b3;
  };

  try {
    const res = await doFetch('https://registry.npmjs.org/@mushi-mushi/cli/latest', {
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      const { version: latest } = (await res.json()) as { version?: string };
      if (latest && isBehind(MUSHI_CLI_VERSION, latest)) {
        checks.push({
          name: 'CLI version',
          ok: true,
          warn: true,
          detail: `Installed ${MUSHI_CLI_VERSION}, latest is ${latest}. Run \`mushi upgrade\` (or npm i -g @mushi-mushi/cli@latest).`,
        });
      }
    }
  } catch {
    // Offline / registry slow — a version check must never fail doctor.
  }

  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    // Each SDK package version-tracks independently of the CLI (core is 1.x
    // while the CLI is 0.x), so compare each dep against ITS OWN npm latest
    // rather than against the CLI version.
    const candidates = Object.entries(deps)
      .filter(([name]) => name.startsWith('@mushi-mushi/'))
      .filter(([, v]) => /^[~^]?\d/.test(v));
    const drifted = (
      await Promise.all(
        candidates.map(async ([name, v]): Promise<[string, string, string] | null> => {
          try {
            const res = await doFetch(`https://registry.npmjs.org/${name}/latest`, {
              signal: AbortSignal.timeout(3_000),
            });
            if (!res.ok) return null;
            const { version: latest } = (await res.json()) as { version?: string };
            return latest && isBehind(v, latest) ? [name, v, latest] : null;
          } catch {
            return null;
          }
        }),
      )
    ).filter((d): d is [string, string, string] => d !== null);
    if (drifted.length > 0) {
      checks.push({
        name: 'SDK version drift',
        ok: true,
        warn: true,
        detail: `${drifted.map(([n, v, l]) => `${n}@${v} (latest ${l})`).join(', ')} — behind npm latest. Run \`mushi upgrade\` in this repo.`,
      });
    }
  } catch {
    // No package.json in cwd — nothing to compare.
  }

  return checks;
}

// ── Server-side pipeline doctor (GET /v1/admin/doctor) ──────────────────────

/**
 * Folds the backend's own silent-failure reconciliation (recovery cron,
 * stranded reports, codebase-index health, observability transports) into
 * the CLI report. Requires an mcp:read-scoped key; skipped quietly for
 * ingest-only keys.
 */
export async function checkPipelineDoctor(
  config: DoctorCliConfig,
  doFetch: typeof fetch,
): Promise<DoctorCheck[]> {
  if (!config.endpoint || !config.apiKey) return [];
  try {
    const res = await doFetch(`${config.endpoint.replace(/\/$/, '')}/v1/admin/doctor`, {
      headers: apiKeyHeaders(config.apiKey),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return []; // ingest-only key — server checks unavailable
    if (!res.ok) {
      return [{
        name: '[pipeline] Server doctor',
        ok: true,
        warn: true,
        detail: `GET /v1/admin/doctor returned HTTP ${res.status} — pipeline health unknown.`,
      }];
    }
    const body = (await res.json()) as {
      data?: { checks?: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; summary: string; hint?: string }> };
    };
    return (body.data?.checks ?? []).map((ch) => ({
      name: `[pipeline] ${ch.name}`,
      ok: ch.status !== 'fail',
      warn: ch.status === 'warn',
      detail: ch.hint ? `${ch.summary} → Fix: ${ch.hint}` : ch.summary,
    }));
  } catch {
    return [{
      name: '[pipeline] Server doctor',
      ok: true,
      warn: true,
      detail: 'Could not reach /v1/admin/doctor (timeout) — pipeline health unknown.',
    }];
  }
}

// ── Main doctor runner ───────────────────────────────────────────────────────

export async function runDoctor(
  config: DoctorCliConfig,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const checks: DoctorCheck[] = [];

  // --full activates every check category in one shot.
  const isFull = options.full === true;
  const runServer = isFull || options.server !== false;
  const runIngest = isFull || options.ingest !== false;

  // 1. CLI config
  checks.push(...checkCliConfig(config));

  // 2. Endpoint reachability
  if (config.endpoint) {
    checks.push(await checkEndpointReachability(config.endpoint, doFetch));
  }

  // 3. SDK install
  const sdkCheck = await checkSdkInstall(options.cwd ?? process.cwd());
  if (sdkCheck) checks.push(sdkCheck);

  // 3b. SDK actually wired in source — installing the package but never
  // adding the init snippet is the single most common half-setup, and it
  // used to be indistinguishable from a fully wired app.
  if (sdkCheck?.ok && !sdkCheck.warn) {
    const { findSdkImport } = await import('./snippet-inject.js');
    const imported = await findSdkImport(options.cwd ?? process.cwd());
    checks.push(
      imported
        ? { name: 'SDK init snippet wired', ok: true, detail: `Found SDK usage in ${imported.file}` }
        : {
            name: 'SDK init snippet wired',
            ok: true,
            warn: true,
            detail:
              'Package installed but no @mushi-mushi import found in src/app — paste the init snippet from `mushi init` into your entry file.',
          },
    );
  }

  // 4. Server preflight (on by default, gracefully skipped for ingest-only keys)
  if (runServer) {
    const serverChecks = await checkServerPreflight(config, doFetch);
    checks.push(...serverChecks);
    // Backend self-diagnostics: recovery cron, stranded reports, codebase
    // index health — the silent-failure modes only the server can see.
    checks.push(...(await checkPipelineDoctor(config, doFetch)));
  }

  // Advisory version drift (never blocks ready).
  checks.push(...(await checkVersionDrift(options.cwd ?? process.cwd(), doFetch)));

  // 5. Ingest setup (on by default)
  if (runIngest) {
    const ingestChecks = await checkIngestSetup(config, doFetch);
    checks.push(...ingestChecks);
  }

  // 6. QA story health (opt-in, or --full)
  if (isFull || options.qaStories) {
    const qaChecks = await checkQaStoriesHealth(config, doFetch);
    checks.push(...qaChecks);
  }

  // 7. Host app wiring (opt-in, or --full)
  if (isFull || options.hostApp) {
    const hostChecks = await checkHostAppWiring(options.cwd ?? process.cwd());
    checks.push(...hostChecks);
  }

  // 8. MCP config health (opt-in, or --full)
  if (isFull || options.mcp) {
    const mcpChecks = await checkMcpConfig(config, options.cwd ?? process.cwd(), doFetch);
    checks.push(...mcpChecks);
  }

  // 9. Browser sign-in (device-auth) path (opt-in, or --full)
  if (isFull || options.auth) {
    checks.push(...(await checkCliAuthPath(config, doFetch)));
  }

  // Post-process: if the SDK is confirmed working via a live heartbeat, downgrade
  // the "SDK installed in this repo" failure to an advisory warning (⚠). Users
  // routinely run `mushi doctor` from a backend repo or the Mushi product root;
  // the local package.json check is a false positive when ingest proves the SDK
  // is already installed and sending data somewhere.
  const heartbeatPassed = checks.some((c) => c.name === '[ingest] Last SDK heartbeat' && c.ok);
  if (heartbeatPassed) {
    const idx = checks.findIndex((c) => c.name === 'SDK installed in this repo' && !c.ok);
    if (idx >= 0) {
      checks[idx] = {
        ...checks[idx],
        ok: true,
        warn: true,
        detail:
          'No @mushi-mushi/* found in cwd package.json — but live heartbeats confirm the SDK is active. Run from your app repo or install with `mushi init`.',
      };
    }
  }

  // `ready` excludes advisory warnings (warn items have ok:true so every() works correctly).
  return { checks, ready: checks.every((c) => c.ok) };
}

// ── Formatter ────────────────────────────────────────────────────────────────

export function formatDoctorResult(result: DoctorResult): string {
  const PASS = 'OK';
  const WARN = 'WARN';
  const FAIL = 'FAIL';
  const lines: string[] = [];

  for (const c of result.checks) {
    const icon = !c.ok ? FAIL : c.warn ? WARN : PASS;
    lines.push(`${icon} ${c.name}`);
    if (c.detail) lines.push(`  ${c.detail}`);
    if (!c.ok) {
      const hint = fixHintForCheck(c.name);
      if (hint) lines.push(`  → Fix: ${hint}`);
    }
  }

  const failed = result.checks.filter((c) => !c.ok);
  const warned = result.checks.filter((c) => c.ok && c.warn);
  if (failed.length === 0) {
    if (warned.length > 0) {
      lines.push(
        `\nAll checks passed with ${warned.length} advisory warning${warned.length === 1 ? '' : 's'}. The CLI is ready.`,
      );
    } else {
      lines.push('\nAll checks passed. The CLI is ready.');
    }
  } else {
    lines.push(`\n${failed.length} check${failed.length === 1 ? '' : 's'} failed.`);
    lines.push('Fix the items above and re-run `mushi doctor`.');
  }

  return lines.join('\n');
}
