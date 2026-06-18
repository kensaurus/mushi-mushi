/**
 * FILE: packages/core/src/identity.ts
 * PURPOSE: The signed-JWT end-user identity contract shared between the SDK
 *          and the Mushi backend.
 *
 * The host app's server mints a short-lived JWT (HS256, signed with the
 * project's identity secret obtained from the console) describing the
 * currently-logged-in end user, and hands it to the SDK via
 * `Mushi.identifyWithToken(jwt)`. The SDK never verifies the signature — it
 * only base64url-decodes the payload to show the user's name locally and
 * forwards the raw token to the backend, which verifies it against the
 * per-project secret before trusting any claim. This mirrors the Featurebase
 * `featurebaseJwt` model and is the trust anchor for "My Reports", rewards,
 * and the per-user assistant data index.
 *
 * Anonymous reporters (logged-out) keep using the random reporter token; the
 * signed JWT is purely additive.
 */

/** Claims carried by a Mushi end-user identity token. */
export interface MushiIdentityClaims {
  /** Mushi external project id this token is scoped to. */
  projectId: string;
  /** The host app's stable id for this end user (becomes `external_user_id`). */
  sub: string;
  /** Optional display email (never stored raw server-side — hashed). */
  email?: string;
  /** Optional display name. */
  name?: string;
  /** Issued-at (seconds since epoch). */
  iat?: number;
  /** Expiry (seconds since epoch). Tokens should be short-lived (<= 1h). */
  exp?: number;
}

/**
 * Sentinel so callers can distinguish a Mushi identity token from the random
 * anonymous reporter token (`mushi_<uuid>`). Identity tokens are standard JWTs
 * (three dot-separated base64url segments), so this prefix is informational
 * only and not embedded in the wire format.
 */
export const MUSHI_IDENTITY_TOKEN_PREFIX = 'mushi.identity';

/**
 * Build the canonical claims object a host server should sign. Exposed so the
 * `@mushi-mushi/node` SDK and docs share one definition of the payload shape.
 */
export function buildIdentityClaims(input: {
  projectId: string;
  userId: string;
  email?: string;
  name?: string;
  ttlSeconds?: number;
}): Required<Pick<MushiIdentityClaims, 'projectId' | 'sub' | 'iat' | 'exp'>> &
  Pick<MushiIdentityClaims, 'email' | 'name'> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds && input.ttlSeconds > 0 ? Math.min(input.ttlSeconds, 3600) : 600;
  return {
    projectId: input.projectId,
    sub: input.userId,
    ...(input.email ? { email: input.email } : {}),
    ...(input.name ? { name: input.name } : {}),
    iat: now,
    exp: now + ttl,
  };
}

function base64UrlDecode(segment: string): string {
  const pad = segment.length % 4 === 0 ? '' : '='.repeat(4 - (segment.length % 4));
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof atob === 'function') return atob(base64);
  // Node / RN without atob
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return B.from(base64, 'base64').toString('binary');
  return '';
}

/**
 * Decode (WITHOUT verifying) the claims of an identity JWT. Returns null if the
 * token is malformed. CLIENT-SIDE DISPLAY ONLY — never trust these claims for
 * authorisation; the server re-verifies the signature.
 */
export function parseIdentityToken(token: string): MushiIdentityClaims | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = base64UrlDecode(parts[1]);
    const payload = JSON.parse(json) as Record<string, unknown>;
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : undefined;
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!projectId || !sub) return null;
    return {
      projectId,
      sub,
      ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
      ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
      ...(typeof payload.iat === 'number' ? { iat: payload.iat } : {}),
      ...(typeof payload.exp === 'number' ? { exp: payload.exp } : {}),
    };
  } catch {
    return null;
  }
}
