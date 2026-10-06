/**
 * FILE: packages/server/src/__tests__/erase-subject-route.test.ts
 * PURPOSE: POST /v1/sdk/erase-subject flow (api/routes/erase-subject.ts):
 *          auth before any lookup, storage before rows, unknown subject = 200/0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => ({}) }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => noop,
  };
  return { log: noop };
});
vi.mock('../../supabase/functions/_shared/end-user-identity.ts', () => ({
  loadIdentitySecret: async () => 'secret',
  verifyHs256: async () => null,
}));
vi.mock('../../supabase/functions/_shared/storage.ts', () => ({
  getStorageAdapter: async () => ({ delete: async () => {} }),
  getStorageSettings: async () => null,
}));
vi.stubGlobal('Deno', { env: { get: () => undefined, toObject: () => ({}) } });

const { eraseSubject } = await import('../../supabase/functions/api/routes/erase-subject.ts');

const PROJECT = '6e7e0c3a-a777-4f1e-a699-6515993cf3bd';
const NOW = 1_800_000_000;

function tokenFor(payload: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig`;
}

const eraseClaims = {
  projectId: PROJECT,
  sub: 'user-42',
  purpose: 'erase-subject',
  iat: NOW,
  exp: NOW + 60,
};

let calls: string[];
let targets: { screenshot_path: string | null }[];
let rateLimited: boolean;
let eraseResult: Record<string, unknown>;

function fakeDb() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(`rpc:${name}`);
      if (name === 'scoped_rate_limit_claim') {
        return { data: null, error: rateLimited ? { message: 'limit' } : null };
      }
      if (name === 'erase_subject_targets') return { data: targets, error: null };
      if (name === 'erase_subject') {
        calls.push(`erase_identity=${String(args.p_erase_identity)}`);
        return { data: eraseResult, error: null };
      }
      return { data: null, error: { message: 'unexpected' } };
    },
  };
}

function deps(over: Partial<Parameters<typeof eraseSubject>[1]> = {}) {
  return {
    db: fakeDb() as never,
    nowSecs: () => NOW,
    loadSecret: async () => {
      calls.push('loadSecret');
      return 'secret';
    },
    verify: async (token: string) => {
      calls.push('verify');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      return token.endsWith('.sig') ? payload : null;
    },
    deleteObject: async (_db: unknown, _p: string, path: string) => {
      calls.push(`delete:${path}`);
    },
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  targets = [];
  rateLimited = false;
  eraseResult = { reports: 0, identity: null, subject_known: false };
});

describe('eraseSubject auth', () => {
  it('401 without a token, before touching the database', async () => {
    const r = await eraseSubject(undefined, deps());
    expect(r).toMatchObject({ status: 401, body: { error: { code: 'ERASE_TOKEN_REQUIRED' } } });
    expect(calls).toEqual([]);
  });

  it('401 for a token with a bad signature, without listing the subject', async () => {
    const r = await eraseSubject(tokenFor(eraseClaims).replace(/\.sig$/, '.bad'), deps());
    expect(r.status).toBe(401);
    expect(calls).not.toContain('rpc:erase_subject_targets');
  });

  it('401 when the project has no identity secret (same answer as a bad signature)', async () => {
    const r = await eraseSubject(tokenFor(eraseClaims), deps({ loadSecret: async () => null }));
    expect(r).toMatchObject({ status: 401, body: { error: { code: 'ERASE_TOKEN_INVALID' } } });
  });

  it('403 for a correctly signed end-user identity token (no purpose claim)', async () => {
    const { purpose: _p, ...identity } = eraseClaims;
    const r = await eraseSubject(tokenFor({ ...identity, email: 'a@example.com' }), deps());
    expect(r).toMatchObject({ status: 403, body: { error: { code: 'ERASE_PURPOSE_REQUIRED' } } });
    expect(calls).not.toContain('rpc:erase_subject');
  });

  it('429 when the per-project rate limit is spent', async () => {
    rateLimited = true;
    const r = await eraseSubject(tokenFor(eraseClaims), deps());
    expect(r.status).toBe(429);
    expect(calls).not.toContain('loadSecret');
  });
});

describe('eraseSubject behaviour', () => {
  it('unknown subject: 200 with zero counts', async () => {
    const r = await eraseSubject(tokenFor(eraseClaims), deps());
    expect(r).toEqual({
      status: 200,
      body: {
        ok: true,
        data: {
          erased: { reports: 0, identity: null, subject_known: false },
          screenshots_deleted: 0,
        },
      },
    });
  });

  it('deletes stored screenshots (deduplicated) before the rows', async () => {
    targets = [
      { screenshot_path: 'storage://supabase/screenshots/a.png' },
      { screenshot_path: 'storage://supabase/screenshots/a.png' },
      { screenshot_path: 'storage://supabase/screenshots/b.png' },
      { screenshot_path: null },
    ];
    eraseResult = { reports: 3, subject_known: true };
    const r = await eraseSubject(tokenFor({ ...eraseClaims, erase_identity: true }), deps());
    expect(r.status).toBe(200);
    const firstRowDelete = calls.indexOf('rpc:erase_subject');
    expect(calls.indexOf('delete:storage://supabase/screenshots/a.png')).toBeLessThan(
      firstRowDelete,
    );
    expect(calls.indexOf('delete:storage://supabase/screenshots/b.png')).toBeLessThan(
      firstRowDelete,
    );
    expect(calls.filter((c) => c.startsWith('delete:'))).toHaveLength(2);
    expect(calls).toContain('erase_identity=true');
  });

  it('a storage failure stops before any row is deleted (502, retryable)', async () => {
    targets = [{ screenshot_path: 'storage://supabase/screenshots/a.png' }];
    const r = await eraseSubject(
      tokenFor(eraseClaims),
      deps({
        deleteObject: async () => {
          throw new Error('boom');
        },
      }),
    );
    expect(r).toMatchObject({ status: 502, body: { error: { code: 'STORAGE_DELETE_FAILED' } } });
    expect(calls).not.toContain('rpc:erase_subject');
  });

  it('keeps the org-level identity unless erase_identity is set', async () => {
    await eraseSubject(tokenFor(eraseClaims), deps());
    expect(calls).toContain('erase_identity=false');
  });
});
