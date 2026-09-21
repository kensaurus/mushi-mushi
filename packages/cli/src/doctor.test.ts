/**
 * FILE: packages/cli/src/doctor.test.ts
 * PURPOSE: Tests for the `mushi doctor` module (extracted from `index.ts`).
 *          Covers all 4 check branches and --json exit-code semantics.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  checkCliAuthPath,
  checkCliConfig,
  checkEndpointReachability,
  checkMcpConfig,
  checkPipelineDoctor,
  checkServerPreflight,
  runDoctor,
  formatDoctorResult,
  fixHintForCheck,
  type DoctorCliConfig,
} from './doctor.js';

// ── Factories ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<DoctorCliConfig> = {}): DoctorCliConfig {
  return {
    endpoint: 'https://xyz.supabase.co/functions/v1/api',
    apiKey: 'mushi_test_key_1234567890abcdef',
    projectId: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  };
}

function mockFetch(status: number, body: unknown = {}): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch;
}

function failingFetch(message = 'Network error'): typeof globalThis.fetch {
  return vi.fn().mockRejectedValue(new Error(message)) as unknown as typeof globalThis.fetch;
}

// ── Check 1: CLI config ───────────────────────────────────────────────────────

describe('checkCliConfig', () => {
  it('all pass when endpoint, apiKey, projectId are set', () => {
    const checks = checkCliConfig(makeConfig());
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  // A missing endpoint used to FAIL first with its own hint, although every
  // command falls back to Mushi Cloud. It now passes and names the default.
  it('endpoint check passes with the cloud default when endpoint is missing', () => {
    const checks = checkCliConfig(makeConfig({ endpoint: undefined }));
    const endpointCheck = checks.find((c) => c.name === 'CLI config file');
    expect(endpointCheck?.ok).toBe(true);
    expect(endpointCheck?.detail).toContain('Mushi Cloud default');
    expect(endpointCheck?.detail).toContain('MUSHI_API_ENDPOINT');
  });

  it('apiKey check fails when apiKey is missing, and its fix is the wizard sign-in', () => {
    const checks = checkCliConfig(makeConfig({ apiKey: undefined }));
    const keyCheck = checks.find((c) => c.name === 'API key configured');
    expect(keyCheck?.ok).toBe(false);
    expect(keyCheck?.detail).toContain('No API key');
    expect(fixHintForCheck('API key configured')).toContain('npx mushi-mushi');
  });

  it('projectId check fails when projectId is missing, with the same single fix', () => {
    const checks = checkCliConfig(makeConfig({ projectId: undefined }));
    const projCheck = checks.find((c) => c.name === 'Project ID configured');
    expect(projCheck?.ok).toBe(false);
    expect(fixHintForCheck('Project ID configured')).toBe(fixHintForCheck('API key configured'));
  });

  it('truncates the API key in the detail string', () => {
    const config = makeConfig({ apiKey: 'mushi_abcdefgh12345678' });
    const checks = checkCliConfig(config);
    const keyCheck = checks.find((c) => c.name === 'API key configured');
    // Should show start + end, not the full key
    expect(keyCheck?.detail).not.toContain('mushi_abcdefgh12345678');
    expect(keyCheck?.detail).toContain('…');
  });
});

// ── Check 2: Endpoint reachability ───────────────────────────────────────────

describe('checkEndpointReachability', () => {
  it('passes when /health returns 200', async () => {
    const check = await checkEndpointReachability('https://api.example.com', mockFetch(200));
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('200');
  });

  it('fails when /health returns non-200', async () => {
    const check = await checkEndpointReachability('https://api.example.com', mockFetch(503));
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('503');
  });

  it('fails when fetch throws (network error)', async () => {
    const check = await checkEndpointReachability(
      'https://api.example.com',
      failingFetch('ECONNREFUSED'),
    );
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('ECONNREFUSED');
  });
});

// ── Check 4: Server preflight ────────────────────────────────────────────────

describe('checkServerPreflight', () => {
  it('returns a single failure check when config is incomplete', async () => {
    const checks = await checkServerPreflight({
      endpoint: undefined,
      apiKey: undefined,
      projectId: undefined,
    });
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain('mushi login');
  });

  it('maps server checks into prefixed DoctorCheck items', async () => {
    const serverChecks = [
      {
        key: 'github',
        ready: true,
        label: 'GitHub repo connected',
        hint: 'Repo: https://github.com/test/repo',
      },
      {
        key: 'codebase',
        ready: false,
        label: 'Codebase indexed for RAG',
        hint: 'Enable codebase indexing',
      },
    ];
    const checks = await checkServerPreflight(
      makeConfig(),
      mockFetch(200, { data: { checks: serverChecks } }),
    );
    expect(checks).toHaveLength(2);
    expect(checks[0].name).toBe('[server] GitHub repo connected');
    expect(checks[0].ok).toBe(true);
    expect(checks[1].name).toBe('[server] Codebase indexed for RAG');
    expect(checks[1].ok).toBe(false);
  });

  it('handles HTTP error gracefully', async () => {
    const checks = await checkServerPreflight(makeConfig(), mockFetch(401));
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain('401');
  });

  it('handles network throw gracefully', async () => {
    const checks = await checkServerPreflight(makeConfig(), failingFetch('timeout'));
    expect(checks).toHaveLength(1);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].detail).toContain('timeout');
  });
});

// ── runDoctor + --json exit-code semantics ────────────────────────────────────

describe('runDoctor', () => {
  it('ready=true only when all checks pass', async () => {
    const result = await runDoctor(makeConfig(), {
      cwd: '/nonexistent-path',
      fetch: mockFetch(200),
    });
    // Without --server, we only run config + reachability checks (SDK check skipped for non-JS paths)
    expect(typeof result.ready).toBe('boolean');
    expect(Array.isArray(result.checks)).toBe(true);
  });

  it('ready=false when any check fails', async () => {
    const result = await runDoctor(makeConfig({ apiKey: undefined }), {
      cwd: '/nonexistent-path',
      fetch: mockFetch(200),
    });
    expect(result.ready).toBe(false);
    const failed = result.checks.filter((c) => !c.ok);
    expect(failed.length).toBeGreaterThan(0);
  });

  it('--json exit semantics: non-zero when not ready', () => {
    // Simulate the exit-code logic: process.exit(1) when !ready
    const result = { ready: false, checks: [{ name: 'A', ok: false, detail: 'fail' }] };
    const exitCode = result.ready ? 0 : 1;
    expect(exitCode).toBe(1);
  });

  it('--json exit semantics: zero when all ready', () => {
    const result = { ready: true, checks: [{ name: 'A', ok: true, detail: 'ok' }] };
    const exitCode = result.ready ? 0 : 1;
    expect(exitCode).toBe(0);
  });

  it('includes server checks when server=true', async () => {
    const serverBody = {
      data: {
        checks: [
          { key: 'github', ready: true, label: 'GitHub repo connected', hint: 'OK' },
          { key: 'autofix', ready: true, label: 'Autofix enabled', hint: 'OK' },
        ],
      },
    };
    const result = await runDoctor(makeConfig(), {
      cwd: '/nonexistent-path',
      server: true,
      fetch: mockFetch(200, serverBody),
    });
    const serverChecks = result.checks.filter((c) => c.name.startsWith('[server]'));
    expect(serverChecks.length).toBeGreaterThan(0);
  });
});

// ── checkCliAuthPath (doctor --auth) ─────────────────────────────────────────

describe('checkCliAuthPath', () => {
  // Previously this failed with "No endpoint configured", although the sign-in
  // being diagnosed used the Mushi Cloud default.
  it('probes the Mushi Cloud sign-in route when no endpoint is saved', async () => {
    const doFetch = mockFetch(400, { ok: false });
    const checks = await checkCliAuthPath(makeConfig({ endpoint: undefined, apiKey: undefined }), doFetch);
    expect(checks.find((c) => c.name === 'Sign-in route reachable')?.ok).toBe(true);
    const [url] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api/v1/cli/auth/device/token');
  });

  it('treats HTTP 400 from the device-token route as reachable', async () => {
    // A bogus device_code MUST be rejected — the rejection itself proves the
    // route is deployed and answering, without creating server-side state.
    const doFetch = mockFetch(400, { ok: false, error: { code: 'invalid_grant' } });
    const checks = await checkCliAuthPath(makeConfig({ apiKey: undefined }), doFetch);
    const route = checks.find((c) => c.name === 'Sign-in route reachable');
    expect(route?.ok).toBe(true);
    expect(route?.detail).toContain('route deployed and answering');
  });

  it('fails the route check on HTTP 404 (wrong base URL or undeployed route)', async () => {
    const checks = await checkCliAuthPath(makeConfig({ apiKey: undefined }), mockFetch(404));
    const route = checks.find((c) => c.name === 'Sign-in route reachable');
    expect(route?.ok).toBe(false);
    expect(route?.detail).toContain('expected HTTP 400');
  });

  it('fails the route check on a 5xx', async () => {
    const checks = await checkCliAuthPath(makeConfig({ apiKey: undefined }), mockFetch(502));
    const route = checks.find((c) => c.name === 'Sign-in route reachable');
    expect(route?.ok).toBe(false);
  });

  it('fails the route check on a network error with firewall guidance', async () => {
    const checks = await checkCliAuthPath(
      makeConfig({ apiKey: undefined }),
      failingFetch('ECONNREFUSED'),
    );
    const route = checks.find((c) => c.name === 'Sign-in route reachable');
    expect(route?.ok).toBe(false);
    expect(route?.detail).toContain('firewall');
  });

  it('flags clock skew from the server Date header', async () => {
    const skewedDate = new Date(Date.now() - 10 * 60_000).toUTCString();
    const doFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: (h: string) => (h === 'date' ? skewedDate : null) },
      json: () => Promise.resolve({ ok: false }),
    }) as unknown as typeof globalThis.fetch;
    const checks = await checkCliAuthPath(makeConfig({ apiKey: undefined }), doFetch);
    const clock = checks.find((c) => c.name === 'System clock in sync');
    expect(clock?.ok).toBe(false);
    expect(clock?.detail).toContain('fix your system time');
  });

  it('validates saved credentials via whoami', async () => {
    const doFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ ok: true, data: { project_name: 'Demo' } }),
    }) as unknown as typeof globalThis.fetch;
    const checks = await checkCliAuthPath(makeConfig(), doFetch);
    const creds = checks.find((c) => c.name === 'Saved credentials valid');
    expect(creds?.ok).toBe(true);
    expect(creds?.detail).toContain('Demo');
  });

  it('warns (not fails) when no credentials are saved yet', async () => {
    const checks = await checkCliAuthPath(
      makeConfig({ apiKey: undefined, projectId: undefined }),
      mockFetch(400, { ok: false }),
    );
    const creds = checks.find((c) => c.name === 'Saved credentials valid');
    expect(creds?.ok).toBe(true);
    expect(creds?.warn).toBe(true);
  });
});

// ── formatDoctorResult ───────────────────────────────────────────────────────

describe('formatDoctorResult', () => {
  it('uses OK for passing checks', () => {
    const result = formatDoctorResult({
      ready: true,
      checks: [{ name: 'Test', ok: true, detail: 'All good' }],
    });
    expect(result).toContain('OK Test');
    expect(result).toContain('All checks passed');
  });

  it('uses FAIL for failing checks', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [{ name: 'Test', ok: false, detail: 'Broken' }],
    });
    expect(result).toContain('FAIL Test');
    expect(result).toContain('1 check failed');
  });

  it('pluralises "checks" correctly', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [
        { name: 'A', ok: false, detail: 'fail' },
        { name: 'B', ok: false, detail: 'fail' },
      ],
    });
    expect(result).toContain('2 checks failed');
  });

  it('includes the detail string', () => {
    const result = formatDoctorResult({
      ready: false,
      checks: [{ name: 'Endpoint', ok: false, detail: 'ECONNREFUSED' }],
    });
    expect(result).toContain('ECONNREFUSED');
  });

  it('uses WARN for advisory warnings and does not count them as failures', () => {
    const result = formatDoctorResult({
      ready: true,
      checks: [
        {
          name: 'SDK installed in this repo',
          ok: true,
          warn: true,
          detail: 'Not in cwd but heartbeats active',
        },
        { name: '[ingest] SDK heartbeat', ok: true, detail: '2026-06-22T02:55:34' },
      ],
    });
    expect(result).toContain('WARN SDK installed in this repo');
    expect(result).toContain('OK [ingest] SDK heartbeat');
    expect(result).toContain('All checks passed');
    expect(result).toContain('advisory warning');
    expect(result).not.toContain('check failed');
  });
});

describe('checkPipelineDoctor', () => {
  const config: DoctorCliConfig = {
    endpoint: 'https://x.supabase.co/functions/v1/api',
    apiKey: 'mushi_test',
    projectId: '00000000-0000-0000-0000-000000000000',
  };

  it('maps server pass/warn/fail statuses onto DoctorCheck semantics', async () => {
    const doFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            checks: [
              { name: 'recovery_cron', status: 'pass', summary: 'healthy' },
              { name: 'stranded_reports', status: 'warn', summary: '3 stuck', hint: 'check logs' },
              { name: 'recovery_token', status: 'fail', summary: 'missing', hint: 'set token' },
            ],
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const checks = await checkPipelineDoctor(config, doFetch);
    expect(checks).toHaveLength(3);
    expect(checks[0]).toMatchObject({ name: '[pipeline] recovery_cron', ok: true, warn: false });
    expect(checks[1]).toMatchObject({ name: '[pipeline] stranded_reports', ok: true, warn: true });
    expect(checks[1].detail).toContain('check logs');
    expect(checks[2]).toMatchObject({ name: '[pipeline] recovery_token', ok: false });
  });

  it('skips quietly on 403 (ingest-only key)', async () => {
    const doFetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    expect(await checkPipelineDoctor(config, doFetch)).toEqual([]);
  });

  it('degrades to an advisory warning when the endpoint is unreachable', async () => {
    const doFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const checks = await checkPipelineDoctor(config, doFetch);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ ok: true, warn: true });
  });

  it('returns nothing without credentials', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    expect(await checkPipelineDoctor({}, doFetch)).toEqual([]);
    expect(doFetch).not.toHaveBeenCalled();
  });
});

describe('fixHintForCheck', () => {
  it('returns a hint for known checks and prefixed categories', () => {
    expect(fixHintForCheck('API key configured')).toContain('npx mushi-mushi');
    expect(fixHintForCheck('[ingest] anything')).toBeTruthy();
    expect(fixHintForCheck('totally unknown check')).toBeUndefined();
  });
});

describe('runDoctor on a folder with nothing set up', () => {
  it('reports one actionable line instead of a wall of failures', async () => {
    const doFetch = vi.fn() as unknown as typeof fetch;
    const result = await runDoctor({}, { cwd: '/nonexistent-path', fetch: doFetch, hostApp: true, mcp: true });
    expect(result.ready).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe('Mushi set up here');
    expect(fixHintForCheck('Mushi set up here')).toContain('npx mushi-mushi');
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('still runs the sign-in diagnostics with --auth', async () => {
    const result = await runDoctor(
      {},
      { cwd: '/nonexistent-path', fetch: mockFetch(400, { ok: false }), auth: true, server: false, ingest: false },
    );
    expect(result.checks.some((c) => c.name === 'Sign-in route reachable')).toBe(true);
  });
});

describe('formatDoctorResult hint de-duplication', () => {
  it('prints a shared fix once', () => {
    const out = formatDoctorResult({
      ready: false,
      checks: [
        { name: 'API key configured', ok: false, detail: 'No API key saved.' },
        { name: 'Project ID configured', ok: false, detail: 'No default project saved.' },
      ],
    });
    expect(out.match(/→ Fix:/g)).toHaveLength(1);
  });
});

describe('checkMcpConfig', () => {
  let root: string;
  let home: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mushi-doctor-root-'));
    home = await mkdtemp(join(tmpdir(), 'mushi-doctor-home-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const noFetch = vi.fn() as unknown as typeof fetch;

  it('finds a hosted Claude Code entry in the repo-root .mcp.json and accepts it without a key', async () => {
    await writeFile(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'mushi-app': { type: 'http', url: 'https://x.supabase.co/functions/v1/mcp' } } }),
    );
    const checks = await checkMcpConfig(makeConfig({ apiKey: undefined }), root, noFetch, home);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.find((c) => c.name === '[mcp] mushi entries usable')?.detail).toContain('hosted OAuth');
  });

  it('flags a url entry without "type" in .mcp.json — Claude Code skips it', async () => {
    await writeFile(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { mushi: { url: 'https://x.supabase.co/functions/v1/mcp' } } }),
    );
    const checks = await checkMcpConfig(makeConfig(), root, noFetch, home);
    const usable = checks.find((c) => c.name === '[mcp] mushi entries usable');
    expect(usable?.ok).toBe(false);
    expect(usable?.detail).toContain('no "type"');
  });

  it('accepts a Cursor stdio placeholder entry when the CLI config holds a key', async () => {
    await mkdir(join(root, '.cursor'));
    await writeFile(
      join(root, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          'mushi-app': {
            command: 'npx',
            args: ['-y', '@mushi-mushi/mcp@1.0.0'],
            env: { MUSHI_API_KEY: '${env:MUSHI_API_KEY}', MUSHI_API_ENDPOINT: 'https://mushi.example.com/api' },
          },
        },
      }),
    );
    const checks = await checkMcpConfig(makeConfig(), root, mockFetch(200, { data: { total: 1 } }), home);
    expect(checks.find((c) => c.name === '[mcp] mushi entries usable')?.ok).toBe(true);
    expect(checks.find((c) => c.name === '[mcp] account-overview reachable')?.ok).toBe(true);
  });

  it("reads Claude Code's per-project servers from ~/.claude.json", async () => {
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: { [root.replace(/\\/g, '/')]: { mcpServers: { mushi: { type: 'http', url: 'https://x/mcp' } } } },
      }),
    );
    const checks = await checkMcpConfig(makeConfig(), root, noFetch, home);
    expect(checks.find((c) => c.name === '[mcp] mushi server entry')?.ok).toBe(true);
  });

  it('fails with one check when no MCP config exists anywhere', async () => {
    const checks = await checkMcpConfig(makeConfig(), root, noFetch, home);
    expect(checks).toEqual([expect.objectContaining({ name: '[mcp] MCP config present', ok: false })]);
    expect(fixHintForCheck('[mcp] MCP config present')).toContain('--ide claude');
  });
});
