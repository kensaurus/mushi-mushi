/**
 * FILE: packages/server/src/__tests__/operator-slack-fence.test.ts
 * PURPOSE: The operator's env SLACK_BOT_TOKEN only serves projects the
 *          operator owns.
 *
 * Why (2026-09-23): the channel picker, "Send test message" and the Slack
 * health probe all fell back to the env token for ANY project without its
 * own Slack install. That token is the operator workspace's bot, so a tenant
 * could list the operator's channels (once the bot had channels:read) and
 * post into the operator's channel. isOperatorProject fences the fallback.
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

function fakeDb(opts: { failRead?: boolean } = {}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            if (opts.failRead) return { data: null, error: { message: 'boom' } };
            if (table !== 'projects' || !OWNERS[id]) return { data: null, error: null };
            return { data: { owner_id: OWNERS[id] }, error: null };
          },
        }),
      }),
    }),
  };
}

function stubEnv(env: Record<string, string | undefined>) {
  vi.stubGlobal('Deno', { env: { get: (k: string) => env[k] } });
}

async function loadGate() {
  vi.resetModules();
  return import('../../supabase/functions/_shared/operator-gate.ts');
}

afterEach(() => vi.unstubAllGlobals());

describe('isOperatorProject', () => {
  it('is true only for a project whose owner is a listed operator', async () => {
    stubEnv({ MUSHI_OPERATOR_USER_IDS: `${OPERATOR}, not-a-uuid` });
    const { isOperatorProject } = await loadGate();
    expect(await isOperatorProject(fakeDb() as never, OPERATOR_PROJECT)).toBe(true);
    expect(await isOperatorProject(fakeDb() as never, TENANT_PROJECT)).toBe(false);
  });

  it('fails closed: no project id, unknown project, failed read, unset secret', async () => {
    stubEnv({ MUSHI_OPERATOR_USER_IDS: OPERATOR });
    const { isOperatorProject } = await loadGate();
    expect(await isOperatorProject(fakeDb() as never, undefined)).toBe(false);
    expect(await isOperatorProject(fakeDb() as never, '33333333-3333-4333-8333-333333333333')).toBe(
      false,
    );
    expect(await isOperatorProject(fakeDb({ failRead: true }) as never, OPERATOR_PROJECT)).toBe(
      false,
    );

    stubEnv({});
    const reloaded = await loadGate();
    expect(await reloaded.isOperatorProject(fakeDb() as never, OPERATOR_PROJECT)).toBe(false);
  });
});

describe('Slack health probe uses the operator bot only for operator projects', () => {
  async function probe(projectId: string | undefined) {
    stubEnv({ MUSHI_OPERATOR_USER_IDS: OPERATOR, SLACK_BOT_TOKEN: 'xoxb-operator' });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, team: 'operator-workspace', bot_id: 'B1' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    const { probeIntegration } =
      await import('../../supabase/functions/_shared/integration-probes.ts');
    const result = await probeIntegration('slack', fakeDb() as never, {}, {}, projectId);
    return { result, fetchMock };
  }

  it('reports the operator workspace for an operator-owned project', async () => {
    const { result, fetchMock } = await probe(OPERATOR_PROJECT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
  });

  it('never sends the operator token for a tenant project', async () => {
    const { result, fetchMock } = await probe(TENANT_PROJECT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe('unknown');
  });

  it('never sends it when the caller does not say which project', async () => {
    const { fetchMock } = await probe(undefined);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
