/**
 * FILE: packages/server/src/__tests__/subject-erasure.test.ts
 * PURPOSE: Erase-token claim checks and storage-path parsing for
 *          POST /v1/sdk/erase-subject (_shared/subject-erasure.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  checkEraseClaims,
  ERASE_SUBJECT_PURPOSE,
  ERASE_TOKEN_MAX_TTL_SECS,
  parseStoragePath,
  peekProjectId,
} from '../../supabase/functions/_shared/subject-erasure.ts';

const PROJECT = '6e7e0c3a-a777-4f1e-a699-6515993cf3bd';
const NOW = 1_800_000_000;

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function tokenWith(payload: unknown): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

const valid = {
  projectId: PROJECT,
  sub: 'user-42',
  purpose: ERASE_SUBJECT_PURPOSE,
  iat: NOW,
  exp: NOW + 120,
};

describe('peekProjectId', () => {
  it('reads a uuid projectId from the payload', () => {
    expect(peekProjectId(tokenWith(valid))).toBe(PROJECT);
  });

  it('refuses missing, malformed and non-uuid tokens', () => {
    expect(peekProjectId(undefined)).toBeNull();
    expect(peekProjectId('not-a-jwt')).toBeNull();
    expect(peekProjectId('a.%%%.c')).toBeNull();
    expect(peekProjectId(tokenWith({ ...valid, projectId: 'proj-1' }))).toBeNull();
    expect(peekProjectId(tokenWith({ ...valid, projectId: 42 }))).toBeNull();
  });
});

describe('checkEraseClaims', () => {
  it('accepts a short-lived erase token and defaults erase_identity to false', () => {
    expect(checkEraseClaims(valid, PROJECT, NOW)).toEqual({
      ok: true,
      projectId: PROJECT,
      sub: 'user-42',
      eraseIdentity: false,
    });
    expect(checkEraseClaims({ ...valid, erase_identity: true }, PROJECT, NOW)).toMatchObject({
      ok: true,
      eraseIdentity: true,
    });
  });

  it('refuses an ordinary end-user identity token (no purpose claim)', () => {
    const { purpose: _purpose, ...identityToken } = valid;
    expect(checkEraseClaims({ ...identityToken, exp: NOW + 600 }, PROJECT, NOW)).toMatchObject({
      ok: false,
      status: 403,
      code: 'ERASE_PURPOSE_REQUIRED',
    });
    expect(checkEraseClaims({ ...valid, purpose: 'identify' }, PROJECT, NOW)).toMatchObject({
      ok: false,
      code: 'ERASE_PURPOSE_REQUIRED',
    });
  });

  it('refuses a token for another project', () => {
    expect(
      checkEraseClaims(
        { ...valid, projectId: '00000000-0000-4000-8000-000000000000' },
        PROJECT,
        NOW,
      ),
    ).toMatchObject({ ok: false, status: 403, code: 'ERASE_PROJECT_MISMATCH' });
  });

  it('refuses expired, long-lived, future-dated and incomplete tokens', () => {
    expect(checkEraseClaims({ ...valid, exp: NOW }, PROJECT, NOW)).toMatchObject({
      code: 'ERASE_TOKEN_EXPIRED',
    });
    expect(
      checkEraseClaims({ ...valid, exp: NOW + ERASE_TOKEN_MAX_TTL_SECS + 1 }, PROJECT, NOW),
    ).toMatchObject({ code: 'ERASE_TOKEN_INVALID' });
    expect(
      checkEraseClaims(
        {
          ...valid,
          iat: NOW + ERASE_TOKEN_MAX_TTL_SECS + 10,
          exp: NOW + ERASE_TOKEN_MAX_TTL_SECS + 20,
        },
        PROJECT,
        NOW,
      ),
    ).toMatchObject({ code: 'ERASE_TOKEN_INVALID' });
    expect(checkEraseClaims({ ...valid, iat: undefined }, PROJECT, NOW)).toMatchObject({
      code: 'ERASE_TOKEN_INVALID',
    });
    expect(checkEraseClaims({ ...valid, sub: '  ' }, PROJECT, NOW)).toMatchObject({
      code: 'ERASE_TOKEN_INVALID',
    });
    expect(checkEraseClaims({ ...valid, sub: 7 }, PROJECT, NOW)).toMatchObject({
      code: 'ERASE_TOKEN_INVALID',
    });
  });
});

describe('parseStoragePath', () => {
  it('splits provider, bucket and key', () => {
    expect(parseStoragePath('storage://supabase/screenshots/p1/r1.png')).toEqual({
      provider: 'supabase',
      bucket: 'screenshots',
      key: 'p1/r1.png',
    });
    expect(parseStoragePath('storage://s3/bucket/prefix/a.webp')).toEqual({
      provider: 's3',
      bucket: 'bucket',
      key: 'prefix/a.webp',
    });
  });

  it('refuses URLs, empty paths and traversal', () => {
    expect(parseStoragePath('https://example.com/a.png')).toBeNull();
    expect(parseStoragePath(null)).toBeNull();
    expect(parseStoragePath('storage://supabase/screenshots/../x.png')).toBeNull();
    expect(parseStoragePath('storage://supabase/screenshots/a//b.png')).toBeNull();
  });
});
