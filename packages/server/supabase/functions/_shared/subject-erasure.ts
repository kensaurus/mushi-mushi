/**
 * FILE: packages/server/supabase/functions/_shared/subject-erasure.ts
 * PURPOSE: Pure checks for POST /v1/sdk/erase-subject (api/routes/erase-subject.ts).
 *
 * A host app's BACKEND erases one of its users (account deletion) by sending
 * an erase token: an HS256 JWT signed with the project's identity secret —
 * the same secret it already uses to mint X-Mushi-User-Token — with
 *
 *   { projectId, sub, purpose: 'erase-subject', iat, exp, erase_identity? }
 *
 * The purpose claim is what separates it from an ordinary identity token: those
 * sit on end users' devices (the SDK forwards them), so they must never be able
 * to erase anything here. `exp` is required and at most 5 minutes after `iat`.
 * `erase_identity: true` also erases the org-level end_users identity — the
 * host sets it only when the person is gone from every app in the org.
 *
 * No Deno, network or Supabase imports: unit-tested under vitest
 * (src/__tests__/subject-erasure.test.ts).
 */

export const ERASE_SUBJECT_PURPOSE = 'erase-subject';
export const ERASE_TOKEN_HEADER = 'X-Mushi-Erase-Token';
/** Longest lifetime an erase token may claim (exp - iat), and clock skew allowed on iat. */
export const ERASE_TOKEN_MAX_TTL_SECS = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EraseClaims {
  projectId?: unknown;
  sub?: unknown;
  purpose?: unknown;
  iat?: unknown;
  exp?: unknown;
  erase_identity?: unknown;
}

export type EraseClaimCheck =
  | { ok: true; projectId: string; sub: string; eraseIdentity: boolean }
  | { ok: false; status: 401 | 403; code: string; message: string };

function base64UrlDecode(segment: string): string {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const bin = atob(segment.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * The project the (not yet verified) token claims, so the right identity
 * secret can be loaded. Nothing else from an unverified token is trusted.
 */
export function peekProjectId(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(base64UrlDecode(parts[1])) as EraseClaims;
    return typeof claims.projectId === 'string' && UUID_RE.test(claims.projectId)
      ? claims.projectId
      : null;
  } catch {
    return null;
  }
}

/** Check the claims of a token whose signature has already been verified. */
export function checkEraseClaims(
  claims: EraseClaims,
  expectedProjectId: string,
  nowSecs: number,
): EraseClaimCheck {
  if (claims.purpose !== ERASE_SUBJECT_PURPOSE) {
    return {
      ok: false,
      status: 403,
      code: 'ERASE_PURPOSE_REQUIRED',
      message: `Erase tokens must carry purpose "${ERASE_SUBJECT_PURPOSE}"; an end-user identity token cannot erase.`,
    };
  }
  if (claims.projectId !== expectedProjectId) {
    return {
      ok: false,
      status: 403,
      code: 'ERASE_PROJECT_MISMATCH',
      message: 'Token project does not match.',
    };
  }
  const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
  if (!sub || sub.length > 256) {
    return {
      ok: false,
      status: 401,
      code: 'ERASE_TOKEN_INVALID',
      message: 'Token has no usable sub.',
    };
  }
  const iat = claims.iat;
  const exp = claims.exp;
  if (
    typeof iat !== 'number' ||
    typeof exp !== 'number' ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp)
  ) {
    return {
      ok: false,
      status: 401,
      code: 'ERASE_TOKEN_INVALID',
      message: 'Token needs numeric iat and exp.',
    };
  }
  if (exp <= nowSecs) {
    return { ok: false, status: 401, code: 'ERASE_TOKEN_EXPIRED', message: 'Token has expired.' };
  }
  if (exp - iat > ERASE_TOKEN_MAX_TTL_SECS || iat > nowSecs + ERASE_TOKEN_MAX_TTL_SECS) {
    return {
      ok: false,
      status: 401,
      code: 'ERASE_TOKEN_INVALID',
      message: `Erase tokens may live at most ${ERASE_TOKEN_MAX_TTL_SECS} seconds.`,
    };
  }
  return {
    ok: true,
    projectId: expectedProjectId,
    sub,
    eraseIdentity: claims.erase_identity === true,
  };
}

/**
 * Split a stored `storage://<provider>/<bucket>/<key>` path. Returns null for
 * anything else (e.g. a bare https URL), which the caller reports as not
 * deletable instead of guessing.
 */
export function parseStoragePath(
  path: string | null | undefined,
): { provider: string; bucket: string; key: string } | null {
  if (!path) return null;
  const m = /^storage:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(path);
  if (!m) return null;
  const [, provider, bucket, key] = m;
  if (key.split('/').some((seg) => seg === '..' || seg === '')) return null;
  return { provider, bucket, key };
}
