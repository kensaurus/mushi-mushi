/**
 * FILE: packages/server/supabase/functions/api/routes/reporter-auth.ts
 * PURPOSE: Resolve the reporter behind a /v1/reporter/* request to the key
 *          every reporter table stores (_shared/reporter-token.ts).
 *
 * Two flows are accepted, in priority order:
 *
 *   (A) Signed digest (what the SDKs send). The SDK never puts the raw token
 *       on the wire:
 *
 *         X-Reporter-Token-Hash: <sha256(token) hex>
 *         X-Reporter-Ts:         <unix ms>
 *         X-Reporter-Hmac:       hex(HMAC-SHA256(
 *                                  secret = projectApiKey,
 *                                  msg    = `${projectId}.${ts}.${tokenHash}`))
 *
 *       The timestamp window stops a captured request being replayed later.
 *       The HMAC key is the public API key, so the signature binds the request
 *       to a project and a time; it is not a secret. The digest is the
 *       credential.
 *
 *   (B) Raw token: `X-Reporter-Token` header (kept out of proxy logs) or
 *       `?reporterToken=`. Accepted for older SDKs.
 *
 * Both flows end in reporterKey(), so the result is the one-way stored key and
 * a stored key presented back as a digest or token matches nothing.
 */

import type { Context } from 'npm:hono@4';
import { reporterKey } from '../../_shared/reporter-token.ts';

export type ReporterAuth =
  | { ok: true; tokenHash: string }
  | { ok: false; status: number; code: string; message: string };

const DIGEST_HEX = /^[0-9a-f]{64}$/i;
const SIGNED_WINDOW_MS = 5 * 60 * 1000;

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `tokenHash` in the result is the stored reporter key (`rk1_…`), named after
 * the reporter_token_hash column it is compared with.
 */
export async function resolveReporterAuth(
  c: Context,
  projectId: string,
  now: () => number = Date.now,
): Promise<ReporterAuth> {
  const headerHash = c.req.header('X-Reporter-Token-Hash');
  const ts = c.req.header('X-Reporter-Ts');
  const sig = c.req.header('X-Reporter-Hmac');
  const apiKey = c.req.header('X-Mushi-Api-Key') || c.req.header('X-Mushi-Project');

  if (headerHash && ts && sig && apiKey) {
    // Refuse anything that is not a SHA-256 hex digest before it reaches the
    // HMAC or, downstream, a PostgREST `or()` filter string.
    if (!DIGEST_HEX.test(headerHash)) {
      return {
        ok: false,
        status: 400,
        code: 'BAD_TOKEN_HASH',
        message: 'X-Reporter-Token-Hash must be a 64-char hex SHA-256 digest',
      };
    }
    const parsedTs = Number(ts);
    if (!Number.isFinite(parsedTs)) {
      return {
        ok: false,
        status: 400,
        code: 'BAD_TIMESTAMP',
        message: 'X-Reporter-Ts must be a unix-ms integer',
      };
    }
    if (Math.abs(now() - parsedTs) > SIGNED_WINDOW_MS) {
      return {
        ok: false,
        status: 401,
        code: 'STALE_REQUEST',
        message: 'X-Reporter-Ts outside 5-minute window',
      };
    }
    const digest = headerHash.toLowerCase();
    const expected = await hmacHex(apiKey, `${projectId}.${parsedTs}.${digest}`);
    if (!constantTimeEqualHex(expected, sig.toLowerCase())) {
      return {
        ok: false,
        status: 401,
        code: 'INVALID_HMAC',
        message: 'X-Reporter-Hmac signature mismatch',
      };
    }
    return { ok: true, tokenHash: await reporterKey(digest) };
  }

  const rawToken = c.req.header('X-Reporter-Token') ?? c.req.query('reporterToken') ?? null;
  if (!rawToken) {
    return {
      ok: false,
      status: 400,
      code: 'MISSING_TOKEN',
      message:
        'Pass X-Reporter-Token-Hash + X-Reporter-Hmac (preferred) or X-Reporter-Token / ?reporterToken=',
    };
  }
  return { ok: true, tokenHash: await reporterKey(rawToken) };
}
