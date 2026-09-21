/**
 * `mushi doctor` — run pre-flight checks for the CLI and (optionally) the
 * Mushi backend. Mirrors the in-console dispatch preflight so devs can spot
 * setup gaps from the terminal without opening the admin UI.
 *
 * Extracted into its own module (matching the `nudge.ts` pattern) so the
 * logic can be unit-tested without spawning a child process.
 */

import { CLOUD_API_ENDPOINT } from './endpoint.js';
import { fetchIngestSetup } from './heartbeat-wait.js';
import { apiKeyHeaders, sanitizeCliCredentials, sanitizeEndpoint } from './sanitize-config.js';

/** The one fix for every missing-credential check: the wizard's browser sign-in. */
const SIGN_IN_HINT =
  'Run `npx mushi-mushi` in your app folder — browser sign-in saves the API key, project and endpoint.';

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
      // No saved endpoint is not a failure: every command falls back to Mushi
      // Cloud (endpoint.ts), so reporting "No endpoint" first sent people
      // hunting for a URL they never needed.
      name: 'CLI config file',
      ok: true,
      detail: config.endpoint
        ? `endpoint=${config.endpoint}`
        : `endpoint=${CLOUD_API_ENDPOINT} (Mushi Cloud default — set MUSHI_API_ENDPOINT for a self-hosted backend)`,
    },
    {
      name: 'API key configured',
      ok: Boolean(config.apiKey),
      detail: config.apiKey
        ? `apiKey=${config.apiKey.slice(0, 8)}…${config.apiKey.slice(-4)}`
        : 'No API key saved.',
    },
    {
      name: 'Project ID configured',
      ok: Boolean(config.projectId),
      detail: config.projectId ? `projectId=${config.projectId}` : 'No default project saved.',
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
  // A sign-in that failed before anything was saved used Mushi Cloud — the
  // wizard's default — so that is the route to diagnose.
  const base = sanitizeEndpoint(config.endpoint ?? CLOUD_API_ENDPOINT);

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
      '@mushi-mushi/vue',
      '@mushi-mushi/svelte',
      '@mushi-mushi/angular',
      '@mushi-mushi/capacitor',
      '@mushi-mushi/node',
    ];
    const installed = sdks.filter((s) => deps[s]);
    return {
      name: 'SDK installed in this repo',
      ok: installed.length > 0,
      detail:
        installed.length > 0
          ? installed.map((s) => `${s}@${deps[s]}`).join(', ')
          : 'No @mushi-mushi/* package in package.json — run `npx mushi-mushi` to install',
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

    // Claude Code reads .mcp.json at the repo root; Cursor reads .cursor/mcp.json.
    let mcpFound: string | null = null;
    for (const rel of ['.mcp.json', join('.cursor', 'mcp.json')]) {
      try {
        await access(join(root, rel));
        mcpFound = rel;
        break;
      } catch {
        /* try next */
      }
    }
    checks.push({
      name: '[host] MCP config',
      ok: mcpFound !== null,
      detail: mcpFound
        ? `${mcpFound} present`
        : 'No .mcp.json (Claude Code) or .cursor/mcp.json (Cursor) — run `npx mushi-mushi setup --ide claude` or `--ide cursor` for two-way reporter replies',
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

// ── Check 7b: Hash-router route-capture advisory ─────────────────────────────
//
// Detects hash-routed SPAs (HashRouter, createHashRouter, location.hash,
// hashchange) in host app source and advises on discoverInventory.routeTemplates
// using `/#/` prefixes, which the web SDK requires for hash fragments.
//
// Returns an advisory (ok:true, warn:true) when hash routing is detected but the
// Mushi init call doesn't appear to configure `/#/` route templates.
// Returns ok:true (no warn) when the templates appear configured.
// Returns nothing ([]) when no hash-router usage is found.

const HASH_ROUTER_PATTERNS = [
  /\bHashRouter\b/,
  /\bcreateHashRouter\b/,
  /location\.hash\b/,
  /addEventListener\(['"]hashchange['"]/,
];

const HASH_TEMPLATE_PATTERN = /['"`]#\//; // detects '/#/...' or '#/...' in Mushi config

async function scanDirForPattern(
  dir: string,
  patterns: RegExp[],
  maxDepth = 6,
  maxFiles = 2000,
): Promise<string | null> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let count = 0;
  async function walk(d: string, depth: number): Promise<string | null> {
    if (depth > maxDepth || count > maxFiles) return null;
    let entries: { name: string; isDirectory(): boolean }[] = [];
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
      const full = join(d, e.name);
      if (e.isDirectory()) {
        const found = await walk(full, depth + 1);
        if (found) return found;
      } else if (/\.[cm]?[jt]sx?$/.test(e.name)) {
        count++;
        try {
          const src = await readFile(full, 'utf8');
          if (patterns.some((p) => p.test(src))) return full;
        } catch {
          /* unreadable, skip */
        }
      }
    }
    return null;
  }
  const { resolve } = await import('node:path');
  for (const sub of ['src', 'app', 'pages', 'lib', 'components']) {
    const found = await walk(join(resolve(dir), sub), 0);
    if (found) return found;
  }
  // Also check root-level entry points
  return walk(resolve(dir), 0);
}

export async function checkHashRouterCapture(cwd: string): Promise<DoctorCheck[]> {
  const hashFile = await scanDirForPattern(cwd, HASH_ROUTER_PATTERNS);
  if (!hashFile) return []; // no hash routing detected — no advisory needed

  // Now check whether the Mushi init has '/#/' templates configured
  const templateFile = await scanDirForPattern(cwd, [HASH_TEMPLATE_PATTERN]);
  if (templateFile) {
    return [
      {
        name: '[host] Hash-router route capture',
        ok: true,
        detail: `Hash-router detected (${hashFile}) and /#/ route templates found in Mushi config — routes will be captured correctly.`,
      },
    ];
  }

  return [
    {
      name: '[host] Hash-router route capture',
      ok: true,
      warn: true,
      detail:
        `Hash-router detected (${hashFile}) but no /#/ route templates found in your Mushi init call. ` +
        `Add discoverInventory.routeTemplates with /#/-prefixed patterns (e.g. ['/#/article/[slug]']) ` +
        `so Mushi captures parametric hash routes correctly — without these, all hash navigations ` +
        `appear as a single "/#/" route in the inventory.`,
    },
  ];
}

// ── Check 8: MCP config health ───────────────────────────────────────────────

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProjectPath(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

interface McpConfigSource {
  path: string;
  servers: Record<string, unknown>;
  /** Claude Code files skip a `url` entry that has no `type`. */
  claudeCode: boolean;
}

/**
 * Read `mcpServers` from every file an MCP client may load for this repo:
 * Claude Code's repo-root `.mcp.json`, Cursor's project and global
 * `mcp.json`, and Claude Code's `~/.claude.json`, which keeps user-scope
 * servers at the top level and local-scope ones under `projects[<abs path>]`.
 */
async function collectMcpSources(
  root: string,
  home: string,
): Promise<{ sources: McpConfigSource[]; invalid: string[] }> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const sources: McpConfigSource[] = [];
  const invalid: string[] = [];

  const plainFiles: Array<{ path: string; claudeCode: boolean }> = [
    { path: join(root, '.mcp.json'), claudeCode: true },
    { path: join(root, '.cursor', 'mcp.json'), claudeCode: false },
    { path: join(home, '.cursor', 'mcp.json'), claudeCode: false },
  ];
  for (const file of plainFiles) {
    // Read directly and let a missing file throw rather than an access()
    // pre-check, which is a TOCTOU race and an extra syscall.
    let raw: string;
    try {
      raw = await readFile(file.path, 'utf8');
    } catch {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const servers = isJsonObject(parsed) && isJsonObject(parsed.mcpServers) ? parsed.mcpServers : {};
      sources.push({ path: file.path, servers, claudeCode: file.claudeCode });
    } catch {
      invalid.push(file.path);
    }
  }

  const claudeJsonPath = join(home, '.claude.json');
  try {
    const parsed: unknown = JSON.parse(await readFile(claudeJsonPath, 'utf8'));
    if (isJsonObject(parsed)) {
      const servers: Record<string, unknown> = isJsonObject(parsed.mcpServers) ? { ...parsed.mcpServers } : {};
      const projects = isJsonObject(parsed.projects) ? parsed.projects : {};
      const wanted = normalizeProjectPath(root);
      for (const [projectPath, entry] of Object.entries(projects)) {
        if (normalizeProjectPath(projectPath) === wanted && isJsonObject(entry) && isJsonObject(entry.mcpServers)) {
          Object.assign(servers, entry.mcpServers);
        }
      }
      sources.push({ path: claudeJsonPath, servers, claudeCode: true });
    }
  } catch {
    // Absent or unreadable: Claude Code may simply not be installed.
  }

  return { sources, invalid };
}

/**
 * Whether one mushi entry can start: hosted entries need a `type` in Claude
 * Code files; stdio entries need a key from somewhere — the literal value, or
 * (for a `${…}` placeholder or no key at all) the CLI config the server falls
 * back to.
 */
function assessMushiEntry(
  source: McpConfigSource,
  name: string,
  entry: unknown,
  cliKeySaved: boolean,
): { usable: boolean; stdio: boolean; detail: string } {
  const label = `${name} (${source.path})`;
  if (!isJsonObject(entry)) return { usable: false, stdio: false, detail: `${label}: not an object` };

  if (typeof entry.url === 'string') {
    if (source.claudeCode && entry.type !== 'http' && entry.type !== 'sse') {
      return {
        usable: false,
        stdio: false,
        detail: `${label}: has a url but no "type": "http" — Claude Code skips it`,
      };
    }
    return { usable: true, stdio: false, detail: `${label}: hosted OAuth — sign in from the IDE's MCP panel` };
  }

  const env = isJsonObject(entry.env) ? entry.env : {};
  const key = env.MUSHI_API_KEY;
  const endpoint = env.MUSHI_API_ENDPOINT;
  if (typeof endpoint === 'string' && !/^https?:\/\//.test(endpoint) && !/^\$\{.+\}$/.test(endpoint)) {
    return { usable: false, stdio: true, detail: `${label}: MUSHI_API_ENDPOINT is not a URL` };
  }
  if (typeof key === 'string' && key.startsWith('mushi_')) {
    return { usable: true, stdio: true, detail: `${label}: key written inline` };
  }
  if (key === undefined || (typeof key === 'string' && /^\$\{.*\}$/.test(key))) {
    return cliKeySaved
      ? { usable: true, stdio: true, detail: `${label}: key from MUSHI_API_KEY or the saved CLI config` }
      : {
          usable: false,
          stdio: true,
          detail: `${label}: reads the key from MUSHI_API_KEY or the CLI config, and neither is set`,
        };
  }
  return { usable: false, stdio: true, detail: `${label}: MUSHI_API_KEY is neither a mushi_ key nor a placeholder` };
}

export async function checkMcpConfig(
  config: DoctorCliConfig,
  cwd: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
  home?: string,
): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const { resolve } = await import('node:path');
  const { homedir } = await import('node:os');
  const root = resolve(cwd);

  // 1. Every file Cursor or Claude Code might load for this repo.
  const { sources, invalid } = await collectMcpSources(root, home ?? homedir());
  if (invalid.length > 0) {
    checks.push({
      name: '[mcp] MCP config valid JSON',
      ok: false,
      detail: `Not valid JSON: ${invalid.join(', ')}`,
    });
  }
  if (sources.length === 0) {
    if (invalid.length === 0) {
      checks.push({
        name: '[mcp] MCP config present',
        ok: false,
        detail: 'No .mcp.json, .cursor/mcp.json, ~/.cursor/mcp.json or ~/.claude.json found.',
      });
    }
    return checks;
  }
  checks.push({
    name: '[mcp] MCP config present',
    ok: true,
    detail: `Found: ${sources.map((s) => s.path).join(', ')}`,
  });

  // 2. Look for mushi / mushi-* server entries across all of them.
  const mushiEntries = sources.flatMap((source) =>
    Object.entries(source.servers)
      .filter(([name]) => name === 'mushi' || name.startsWith('mushi-'))
      .map(([name, entry]) => ({ source, name, entry })),
  );
  if (mushiEntries.length === 0) {
    checks.push({
      name: '[mcp] mushi server entry',
      ok: false,
      detail: 'No mushi or mushi-* server in any MCP config.',
    });
    return checks;
  }
  checks.push({
    name: '[mcp] mushi server entry',
    ok: true,
    detail: `Found: ${mushiEntries.map(({ name }) => name).join(', ')}`,
  });

  // 3. Each entry must be able to start (hosted type, or a key it can resolve).
  const assessed = mushiEntries.map(({ source, name, entry }) =>
    assessMushiEntry(source, name, entry, Boolean(config.apiKey)),
  );
  checks.push({
    name: '[mcp] mushi entries usable',
    ok: assessed.every((a) => a.usable),
    detail: assessed.map((a) => a.detail).join('; '),
  });

  // 4. Probe the API with the saved key — only meaningful for stdio entries;
  // hosted entries sign in with their own OAuth-minted key.
  if (assessed.some((a) => a.stdio && a.usable) && config.apiKey && config.endpoint) {
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
  'Mushi set up here':
    'Run `npx mushi-mushi` in your app folder — it signs you in, installs the SDK and writes the env vars.',
  'API key configured': SIGN_IN_HINT,
  'Project ID configured': SIGN_IN_HINT,
  'Endpoint reachable':
    'Check your network and that MUSHI_API_ENDPOINT points at `…/functions/v1/api`.',
  '[ingest]':
    'Open the console Onboarding wizard → Install SDK → submit a test report, or run `mushi connect --wait`.',
  '[server]':
    'Open Settings → Integrations: connect GitHub, index codebase, add Anthropic BYOK key, enable autofix.',
  '[mcp]':
    'Run `npx mushi-mushi setup --ide cursor` (or `--ide claude`) to rewrite the Mushi MCP entry.',
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

  const sdkCheck = await checkSdkInstall(options.cwd ?? process.cwd());

  // Nothing set up at all — no saved credentials and no SDK in this folder.
  // Every downstream check would fail with its own hint (ten of them on a
  // fresh project), so say the one thing that fixes all of them. `--auth`
  // still runs: it diagnoses a sign-in that failed before anything was saved.
  // `--full` asked for every check, so it gets them.
  if (!config.apiKey && !config.projectId && !sdkCheck?.ok && !options.auth && !isFull) {
    return {
      ready: false,
      checks: [
        {
          name: 'Mushi set up here',
          ok: false,
          detail: 'Not set up yet — no saved Mushi credentials and no Mushi SDK in this folder.',
        },
      ],
    };
  }

  // 1. CLI config
  checks.push(...checkCliConfig(config));

  // 2. Endpoint reachability
  if (config.endpoint) {
    checks.push(await checkEndpointReachability(config.endpoint, doFetch));
  }

  // 3. SDK install
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
    // 7b. Hash-router advisory (piggybacks on hostApp; zero-noise when no hash routing present)
    const hashChecks = await checkHashRouterCapture(options.cwd ?? process.cwd());
    checks.push(...hashChecks);
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
  // Several checks share one fix (e.g. missing key + missing project both
  // mean "sign in"); print it once instead of once per failed check.
  const printedHints = new Set<string>();

  for (const c of result.checks) {
    const icon = !c.ok ? FAIL : c.warn ? WARN : PASS;
    lines.push(`${icon} ${c.name}`);
    if (c.detail) lines.push(`  ${c.detail}`);
    if (!c.ok) {
      const hint = fixHintForCheck(c.name);
      if (hint && !printedHints.has(hint)) {
        printedHints.add(hint);
        lines.push(`  → Fix: ${hint}`);
      }
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
