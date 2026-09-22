import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { buildManifestTools } from './manifest-tools.ts';

class TestMcpError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

Deno.test('hosted add_byok_key preserves numeric priority and numeric defaults', async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const tools = buildManifestTools({
    apiCall: (path, init) => {
      calls.push({ path, init });
      return Promise.resolve({ ok: true });
    },
    requireString: (value, name) => {
      if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
    },
    McpError: TestMcpError,
    ERR_INVALID_PARAMS: -32602,
  });
  const context = {
    authHeaders: { Authorization: 'Bearer redacted' },
    projectIdHint: '3a1763bf-5a64-4e42-abde-85dc0219787d',
  };

  await tools.add_byok_key.handler(
    {
      projectId: context.projectIdHint,
      provider: 'firecrawl',
      key: 'fc-redacted-test-key',
      priority: 25,
    },
    context,
  );
  await tools.add_byok_key.handler(
    {
      projectId: context.projectIdHint,
      provider: 'browserbase',
      key: 'bb-redacted-test-key',
    },
    context,
  );

  const explicitBody = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  const defaultBody = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;
  assertEquals(explicitBody.priority, 25);
  assertEquals(typeof explicitBody.priority, 'number');
  assertEquals(defaultBody.priority, 100);
  assertEquals(typeof defaultBody.priority, 'number');
});

Deno.test('manifest tools advertise the canonical input schema, title and hints', async () => {
  const { MCP_DISCOVERY } = await import('../_shared/mcp-server-card.ts');
  const manifest = (await import('../_shared/mcp-hosted-tool-manifest.json', { with: { type: 'json' } })).default as Record<
    string,
    { scope: string; required?: string[] }
  >;
  const tools = buildManifestTools({
    apiCall: () => Promise.resolve({}),
    requireString: () => {},
    McpError: TestMcpError,
    ERR_INVALID_PARAMS: -32602,
  });
  let withCanonical = 0;
  for (const [name, def] of Object.entries(tools)) {
    const canonical = MCP_DISCOVERY.tools[name];
    if (!canonical) continue;
    withCanonical++;
    assertEquals(def.inputSchema, canonical.inputSchema, `${name} inputSchema`);
    assertEquals(def.title, canonical.title, `${name} title`);
    assertEquals(def.description, canonical.description, `${name} description`);
    // The handler enforces spec.required; the advertised schema must declare them.
    const properties = Object.keys((def.inputSchema.properties ?? {}) as Record<string, unknown>);
    for (const req of manifest[name]?.required ?? []) {
      assertEquals(properties.includes(req), true, `${name} advertises required parameter ${req}`);
    }
    // A write tool without an explicit destructiveHint reads as destructive in clients.
    if (def.scope === 'mcp:write') {
      assertEquals(typeof def.annotations?.destructiveHint, 'boolean', `${name} destructiveHint`);
    }
  }
  assertEquals(withCanonical > 40, true, `only ${withCanonical} manifest tools matched the catalog`);
});

// ── Casing, wire mapping and output shapes (2026-09-22) ──────────────────────
// Handlers read the catalog's camelCase names (handleToolsCall renames
// snake_case aliases first) and map them to the field names each route reads;
// results match the catalog outputSchema the tool now advertises.

function recordingTools(respond: (path: string) => unknown = () => ({})) {
  const calls: Array<{ path: string; init: RequestInit & { headers: Record<string, string> } }> = [];
  const tools = buildManifestTools({
    apiCall: (path, init) => {
      calls.push({ path, init });
      return Promise.resolve(respond(path));
    },
    requireString: (value, name) => {
      if (typeof value !== 'string' || !value) throw new TestMcpError(-32602, `${name} is required`);
    },
    McpError: TestMcpError,
    ERR_INVALID_PARAMS: -32602,
  });
  return { tools, calls };
}

const CTX = { authHeaders: { Authorization: 'Bearer redacted' }, projectIdHint: '3a1763bf-5a64-4e42-abde-85dc0219787d' };
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body)) as Record<string, unknown>;

Deno.test('manifest tools send the wire field names their routes read', async () => {
  const { tools, calls } = recordingTools();
  await tools.award_bonus_points.handler({ externalUserId: 'u1', points: 500, reason: 'found a P0' }, CTX);
  assertEquals(bodyOf(calls[0].init), { external_user_id: 'u1', points: 500, reason: 'found a P0' });
  await tools.set_tier.handler({ externalUserId: 'u1', tierSlug: 'champion' }, CTX);
  assertEquals(bodyOf(calls[1].init), { external_user_id: 'u1', tier_slug: 'champion' });
  await tools.checkin_pipeline_step.handler({ runId: 'run-1', stepIndex: 0, status: 'passed', prUrl: 'https://gh/pr/1' }, CTX);
  assertEquals(calls[2].path, '/v1/admin/skills/pipelines/run-1/steps/0/checkin');
  assertEquals(bodyOf(calls[2].init), { status: 'passed', pr_url: 'https://gh/pr/1' });
  await tools.start_skill_pipeline.handler({ rootSkillSlug: 'workflow-fix-and-ship', reportId: 'r1' }, CTX);
  assertEquals(bodyOf(calls[3].init), { root_skill_slug: 'workflow-fix-and-ship', report_id: 'r1', project_id: CTX.projectIdHint });
});

Deno.test('a required number is checked for presence, not as a string', async () => {
  const { tools } = recordingTools();
  // points=500 used to fail requireString; stepIndex=0 is falsy but present.
  await tools.award_bonus_points.handler({ externalUserId: 'u1', points: 500, reason: 'r' }, CTX);
  await tools.checkin_pipeline_step.handler({ runId: 'run-1', stepIndex: 0, status: 'passed' }, CTX);
  let threw = false;
  try {
    await tools.award_bonus_points.handler({ externalUserId: 'u1', reason: 'r' }, CTX);
  } catch (err) {
    threw = err instanceof TestMcpError && /points is required/.test(err.message);
  }
  assertEquals(threw, true);
});

Deno.test('optional query parameters are dropped when unset; booleans are flags', async () => {
  const { tools, calls } = recordingTools(() => ({}));
  await tools.get_file_summary.handler({ filePath: 'src/app.ts' }, CTX);
  assertEquals(calls[0].path, `/v1/admin/projects/${CTX.projectIdHint}/codebase/summary?file_path=src%2Fapp.ts`);
  await tools.get_file_summary.handler({ filePath: 'src/app.ts', symbolName: 'main', force: true }, CTX);
  assertEquals(calls[1].path, `/v1/admin/projects/${CTX.projectIdHint}/codebase/summary?file_path=src%2Fapp.ts&symbol_name=main&force=1`);
  await tools.analyze_codebase_impact.handler({ paths: ['a.ts', 'b.ts'], fixId: 'f1' }, CTX);
  assertEquals(calls[2].path, `/v1/admin/projects/${CTX.projectIdHint}/codebase/impact?paths=a.ts%2Cb.ts&fix_id=f1`);
  await tools.get_codebase_tour.handler({ force: false }, CTX);
  assertEquals(calls[3].path, `/v1/admin/projects/${CTX.projectIdHint}/codebase/tour`);
});

Deno.test('ask_codebase sends the message list the chat route requires', async () => {
  const { tools, calls } = recordingTools();
  await tools.ask_codebase.handler({ question: 'where is auth?', filePath: 'src/auth.ts', threadId: 't-1' }, CTX);
  assertEquals(bodyOf(calls[0].init), {
    messages: [{ role: 'user', content: 'where is auth?' }],
    threadId: 't-1',
    fileFocus: { file_path: 'src/auth.ts', symbol_name: null },
  });
});

Deno.test('submit_fix_result creates the attempt, completes it, and returns { ok, fixId }', async () => {
  const { tools, calls } = recordingTools((path) => (path === '/v1/admin/fixes' ? { fixId: 'fix-9' } : {}));
  const args = { reportId: 'r1', branch: 'fix/pay', prUrl: 'https://gh/pr/2', filesChanged: ['a.ts'], linesChanged: 4, summary: 'bind handler' };
  const result = await tools.submit_fix_result.handler(args, CTX);
  assertEquals(result, { ok: true, fixId: 'fix-9' });
  assertEquals(calls[0].init.method, 'POST');
  assertEquals(bodyOf(calls[0].init), { reportId: 'r1', agent: 'mcp' });
  assertEquals(calls[1].path, '/v1/admin/fixes/fix-9');
  assertEquals(calls[1].init.method, 'PATCH');
  const patch = bodyOf(calls[1].init);
  assertEquals([patch.status, patch.branch, patch.pr_url, patch.files_changed, patch.lines_changed], ['completed', 'fix/pay', 'https://gh/pr/2', ['a.ts'], 4]);
  // A retry with the same arguments derives the same Idempotency-Key.
  await tools.submit_fix_result.handler(args, CTX);
  const key = calls[0].init.headers['Idempotency-Key'];
  assertEquals(typeof key === 'string' && /^[0-9a-f-]{36}$/.test(key), true);
  assertEquals(calls[2].init.headers['Idempotency-Key'], key);
});

Deno.test('reopen_report, list_skills and get_account_overview return their catalog shapes', async () => {
  const { tools } = recordingTools((path) =>
    path.startsWith('/v1/admin/skills')
      ? [{ slug: 'a' }, { slug: 'b' }]
      : path === '/v1/admin/mcp/account-overview'
        ? { projects: [{ id: 'p1' }], total: 1, toolCount: 76 }
        : { id: 'r1', status: 'reopened' },
  );
  assertEquals(await tools.reopen_report.handler({ reportId: 'r1' }, CTX), { report: { id: 'r1', status: 'reopened' } });
  assertEquals(await tools.list_skills.handler({}, CTX), { skills: [{ slug: 'a' }, { slug: 'b' }], count: 2 });
  const overview = (await tools.get_account_overview.handler({}, CTX)) as Record<string, unknown>;
  assertEquals(overview.projects, [{ id: 'p1' }]);
  assertEquals(overview.active_project_id, CTX.projectIdHint);
  assertEquals(overview.toolCount, 76);
  assertEquals(typeof overview.multi_project_hint, 'string');
});

Deno.test('manifest tools advertise the catalog outputSchema', async () => {
  const { MCP_DISCOVERY } = await import('../_shared/mcp-server-card.ts');
  const { tools } = recordingTools();
  let withOutput = 0;
  for (const [name, def] of Object.entries(tools)) {
    assertEquals(def.outputSchema, MCP_DISCOVERY.tools[name]?.outputSchema, `${name} outputSchema`);
    if (def.outputSchema) withOutput++;
  }
  assertEquals(withOutput > 5, true, `only ${withOutput} manifest tools carry an outputSchema`);
});
