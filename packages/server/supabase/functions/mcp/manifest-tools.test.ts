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
