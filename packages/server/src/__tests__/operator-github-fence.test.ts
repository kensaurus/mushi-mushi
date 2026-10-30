/**
 * FILE: packages/server/src/__tests__/operator-github-fence.test.ts
 * PURPOSE: The env GITHUB_TOKEN only serves projects the operator owns, as
 *          the env Slack bot does (operator-slack-fence.test.ts).
 *
 * Why (2026-10-30): the platform token is the operator's own GitHub
 * credential. An app without its own install or token used to fall back to it
 * for any repo URL its owner typed, and the GitHub card told every app it
 * could leave the token empty. platformGithubTokenFor fences the fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const OPERATOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPERATOR_PROJECT = '11111111-1111-4111-8111-111111111111';
const TENANT_PROJECT = '22222222-2222-4222-8222-222222222222';

const OWNERS: Record<string, string> = {
  [OPERATOR_PROJECT]: OPERATOR,
  [TENANT_PROJECT]: TENANT,
};

/** Every table answers empty except `projects`, which answers its owner. */
function fakeDb() {
  const chain = (table: string) => {
    let id = '';
    const q = {
      select: () => q,
      eq: (_col: string, value: string) => {
        id = value;
        return q;
      },
      maybeSingle: async () =>
        table === 'projects' && OWNERS[id]
          ? { data: { owner_id: OWNERS[id] }, error: null }
          : { data: null, error: null },
    };
    return q;
  };
  return { from: chain, rpc: async () => ({ data: null, error: null }) };
}

function stubEnv(env: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
}

const ENV = { MUSHI_OPERATOR_USER_IDS: OPERATOR, GITHUB_TOKEN: 'ghp_operator' };

async function loadGithub() {
  vi.resetModules();
  return import('../../supabase/functions/_shared/github.ts');
}

afterEach(() => vi.unstubAllGlobals());

describe('platformGithubTokenFor', () => {
  it('answers the env token only for an operator-owned project', async () => {
    stubEnv(ENV);
    const { platformGithubTokenFor } = await loadGithub();
    expect(await platformGithubTokenFor(fakeDb(), OPERATOR_PROJECT)).toBe('ghp_operator');
    expect(await platformGithubTokenFor(fakeDb(), TENANT_PROJECT)).toBeNull();
    expect(await platformGithubTokenFor(fakeDb(), null)).toBeNull();
  });

  it('fails closed with no operator list or no token', async () => {
    stubEnv({ GITHUB_TOKEN: 'ghp_operator' });
    expect(await (await loadGithub()).platformGithubTokenFor(fakeDb(), OPERATOR_PROJECT)).toBeNull();
    stubEnv({ MUSHI_OPERATOR_USER_IDS: OPERATOR });
    expect(await (await loadGithub()).platformGithubTokenFor(fakeDb(), OPERATOR_PROJECT)).toBeNull();
  });
});

describe('resolveProjectGithubToken without a stored token or install', () => {
  it('gives another app nothing and the operator its token', async () => {
    stubEnv(ENV);
    const { resolveProjectGithubToken } = await loadGithub();
    expect(await resolveProjectGithubToken(fakeDb() as never, TENANT_PROJECT)).toBeNull();
    expect(await resolveProjectGithubToken(fakeDb() as never, OPERATOR_PROJECT)).toBe('ghp_operator');
  });

  it('still honours allowEnvFallback: false for the operator', async () => {
    stubEnv(ENV);
    const { resolveProjectGithubToken } = await loadGithub();
    expect(
      await resolveProjectGithubToken(fakeDb() as never, OPERATOR_PROJECT, null, { allowEnvFallback: false }),
    ).toBeNull();
  });
});

describe('the GitHub card source', () => {
  async function source(projectId: string) {
    stubEnv(ENV);
    vi.resetModules();
    const { resolveEffectivePlatformSettings } = await import(
      '../../supabase/functions/_shared/integration-settings.ts'
    );
    const out = await resolveEffectivePlatformSettings(fakeDb() as never, projectId);
    return out.sourceByField.github_installation_token_ref;
  }

  it('reports the env token only on the operator app', async () => {
    expect(await source(OPERATOR_PROJECT)).toBe('env');
    expect(await source(TENANT_PROJECT)).toBeNull();
  });
});
