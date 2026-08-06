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
