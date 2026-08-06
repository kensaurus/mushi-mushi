import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  createByokKeySchema,
  isRunnableByokPoolState,
  patchByokKeySchema,
  probeByokKey,
  validateOpenAiBaseUrl,
} from './byok-validation.ts';

function mockFetch(
  status: number,
  inspect?: (input: string | URL | Request, init?: RequestInit) => void,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    inspect?.(input, init);
    return new Response(null, { status });
  }) as typeof fetch;
}

Deno.test(
  'createByokKeySchema bounds opaque credentials without enforcing brittle prefixes',
  () => {
    const parsed = createByokKeySchema.parse({
      projectId: '3a1763bf-5a64-4e42-abde-85dc0219787d',
      provider: 'anthropic',
      apiKey: '  vendor_key-with.unusual=characters  ',
      priority: 0,
    });

    assertEquals(parsed.apiKey, 'vendor_key-with.unusual=characters');
    assert(
      !createByokKeySchema.safeParse({
        projectId: 'not-a-uuid',
        provider: 'unknown',
        apiKey: 'short',
      }).success,
    );
  },
);

Deno.test(
  'patchByokKeySchema rejects empty writes and lifecycle states controlled by probes',
  () => {
    const projectId = '3a1763bf-5a64-4e42-abde-85dc0219787d';
    assert(!patchByokKeySchema.safeParse({ projectId }).success);
    assert(!patchByokKeySchema.safeParse({ projectId, status: 'auth_failed' }).success);
    assert(patchByokKeySchema.safeParse({ projectId, status: 'disabled' }).success);
  },
);

Deno.test('isRunnableByokPoolState matches runtime lifecycle and cooldown admission', () => {
  const now = Date.parse('2026-08-06T00:00:00.000Z');
  assert(isRunnableByokPoolState({ status: 'active', test_status: 'ok' }, now));
  assert(
    isRunnableByokPoolState(
      {
        status: 'quota_exhausted',
        test_status: 'error_quota',
        cooldown_until: '2026-08-05T23:59:59.000Z',
      },
      now,
    ),
  );
  assert(
    !isRunnableByokPoolState(
      {
        status: 'quota_exhausted',
        test_status: 'error_quota',
        cooldown_until: '2026-08-06T00:00:01.000Z',
      },
      now,
    ),
  );
  assert(!isRunnableByokPoolState({ status: 'auth_failed', test_status: 'error_auth' }, now));
});

Deno.test('validateOpenAiBaseUrl normalizes known compatible providers', () => {
  assertEquals(validateOpenAiBaseUrl('https://openrouter.ai/api/v1/'), {
    ok: true,
    value: 'https://openrouter.ai/api/v1',
  });
  assertEquals(validateOpenAiBaseUrl(undefined), { ok: true, value: 'https://api.openai.com/v1' });
});

Deno.test('validateOpenAiBaseUrl blocks SSRF-shaped and credential-bearing destinations', () => {
  for (const value of [
    'http://api.openai.com/v1',
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://user:password@api.openai.com/v1',
    'https://api.openai.com:8443/v1',
    'https://api.openai.com/v1?target=internal',
  ]) {
    const result = validateOpenAiBaseUrl(value);
    assert(!result.ok, `${value} must be rejected`);
  }
});

Deno.test('validateOpenAiBaseUrl supports explicit operator allowlist additions', () => {
  assertEquals(validateOpenAiBaseUrl('https://llm.example.com/v1', ['llm.example.com']), {
    ok: true,
    value: 'https://llm.example.com/v1',
  });
});

Deno.test('probeByokKey activates only credentials accepted by the provider', async () => {
  let authorization = '';
  const result = await probeByokKey(
    'openai',
    'sk-test-secret-never-returned',
    'https://openrouter.ai/api/v1',
    mockFetch(200, (input, init) => {
      assertEquals(String(input), 'https://openrouter.ai/api/v1/models');
      authorization = new Headers(init?.headers).get('Authorization') ?? '';
    }),
  );

  assertEquals(authorization, 'Bearer sk-test-secret-never-returned');
  assertEquals(result.status, 'ok');
  assertEquals(result.keyStatus, 'active');
  assert(!JSON.stringify(result).includes('sk-test-secret-never-returned'));
});

Deno.test(
  'probeByokKey classifies auth, quota, provider, and transport failures distinctly',
  async () => {
    assertEquals(
      (await probeByokKey('anthropic', 'test-secret', undefined, mockFetch(401))).keyStatus,
      'auth_failed',
    );
    assertEquals(
      (await probeByokKey('cursor', 'test-secret', undefined, mockFetch(429))).keyStatus,
      'quota_exhausted',
    );
    assertEquals(
      (await probeByokKey('browserbase', 'test-secret', undefined, mockFetch(503))).keyStatus,
      'pending_validation',
    );

    const throwingFetch = (async () => {
      throw new Error('Bearer secret-that-must-not-leak');
    }) as typeof fetch;
    const transport = await probeByokKey('firecrawl', 'test-secret', undefined, throwingFetch);
    assertEquals(transport.status, 'error_network');
    assertMatch(transport.detail, /could not be completed/);
    assert(!JSON.stringify(transport).includes('secret-that-must-not-leak'));
  },
);
