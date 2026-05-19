/**
 * FILE: _shared/verify-host-jwt.ts
 * PURPOSE: P2 Rewards — verifies host-app JWTs against project-configured
 *   JWKS providers. Required before processing monetary payouts.
 *
 * Flow:
 *   1. Load provider config from host_auth_providers (project-scoped).
 *   2. Fetch JWKS from provider URL (cached 1 hour in jwks_cache table
 *      + Deno module-level Map for in-process reuse).
 *   3. Verify signature, exp, aud, iss, sub.
 *   4. Persist jwt_verified_at on end_users row.
 *
 * Returns: { sub: string, provider: string } on success, throws on failure.
 *
 * KYC NOTE: This verification gate is the AML/KYC firewall. Monetary payouts
 *   MUST NOT be processed for users where jwt_verified_at IS NULL.
 */

import { getServiceClient } from "./db.ts";

// ── In-process JWKS cache ─────────────────────────────────────────
interface CachedJwks {
  keys: JwkKey[];
  expiresAt: number;
}

interface JwkKey {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

const JWK_CACHE = new Map<string, CachedJwks>();
const JWK_TTL_MS = 60 * 60 * 1_000; // 1 hour

interface ProviderConfig {
  jwks_url: string;
  audience: string | null;
  issuer: string | null;
  provider: string;
}

// ── Fetch + cache JWKS ────────────────────────────────────────────
async function getJwks(
  jwksUrl: string,
  db: ReturnType<typeof getServiceClient>,
): Promise<JwkKey[]> {
  const now = Date.now();
  const cached = JWK_CACHE.get(jwksUrl);
  if (cached && cached.expiresAt > now) return cached.keys;

  // Attempt DB cache (cross-function persistence)
  const { data: dbCached } = await db
    .from("jwks_cache")
    .select("payload, expires_at")
    .eq("jwks_url", jwksUrl)
    .maybeSingle();

  if (dbCached && new Date(dbCached.expires_at).getTime() > now) {
    const keys = (dbCached.payload as { keys: JwkKey[] }).keys;
    JWK_CACHE.set(jwksUrl, { keys, expiresAt: new Date(dbCached.expires_at).getTime() });
    return keys;
  }

  // Fetch fresh
  const res = await fetch(jwksUrl, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} ${jwksUrl}`);
  const json = await res.json() as { keys: JwkKey[] };
  const keys = json.keys;
  const expiresAt = now + JWK_TTL_MS;

  // Persist to DB
  await db
    .from("jwks_cache")
    .upsert({
      jwks_url: jwksUrl,
      payload: { keys },
      fetched_at: new Date().toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
    }, { onConflict: "jwks_url" });

  JWK_CACHE.set(jwksUrl, { keys, expiresAt });
  return keys;
}

// ── JWT parsing ───────────────────────────────────────────────────
function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const decoded = atob(padded + "=".repeat(padLen));
  return new Uint8Array([...decoded].map((c) => c.charCodeAt(0)));
}

interface JwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

function parseJwtUnsafe(token: string): { header: Record<string, string>; payload: JwtPayload } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT: expected 3 parts");
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0]))) as Record<string, string>;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1]))) as JwtPayload;
  return { header, payload };
}

// ── Verify signature using Web Crypto ────────────────────────────
async function verifyJwtSignature(
  token: string,
  keys: JwkKey[],
): Promise<JwtPayload> {
  const { header, payload } = parseJwtUnsafe(token);
  const alg = header.alg ?? "RS256";
  const kid = header.kid;

  const candidateKeys = kid
    ? keys.filter((k) => k.kid === kid)
    : keys.filter((k) => k.use === "sig" || !k.use);

  if (candidateKeys.length === 0) {
    throw new Error(`No matching JWK for kid=${kid ?? "any"}`);
  }

  const [headerB64, payloadB64, sigB64] = token.split(".");
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = base64UrlDecode(sigB64);

  for (const jwk of candidateKeys) {
    try {
      let cryptoKey: CryptoKey;
      if (alg.startsWith("RS") || alg.startsWith("PS")) {
        const rsaAlg: RsaHashedImportParams = {
          name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
          hash: `SHA-${alg.slice(-3)}`,
        };
        cryptoKey = await crypto.subtle.importKey("jwk", jwk, rsaAlg, false, ["verify"]);
        const ok = await crypto.subtle.verify(rsaAlg, cryptoKey, sig, signingInput);
        if (ok) return payload;
      } else if (alg.startsWith("ES")) {
        const ecAlg: EcKeyImportParams = {
          name: "ECDSA",
          namedCurve: jwk.crv ?? "P-256",
        };
        cryptoKey = await crypto.subtle.importKey("jwk", jwk, ecAlg, false, ["verify"]);
        const ecSigAlg: EcdsaParams = {
          name: "ECDSA",
          hash: `SHA-${alg.slice(-3)}`,
        };
        const ok = await crypto.subtle.verify(ecSigAlg, cryptoKey, sig, signingInput);
        if (ok) return payload;
      }
    } catch {
      // Try next key
    }
  }
  throw new Error("JWT signature verification failed — no matching key validated");
}

// ── Public API ────────────────────────────────────────────────────
export interface JwtVerificationResult {
  sub: string;
  provider: string;
  payload: JwtPayload;
}

/**
 * verifyHostJwt — verifies a host-app JWT against the project's configured
 * JWKS provider. Throws on failure; returns { sub, provider, payload } on success.
 *
 * Required before ANY monetary payout (KYC firewall).
 */
export async function verifyHostJwt(opts: {
  token: string;
  projectId: string;
  endUserId: string;
}): Promise<JwtVerificationResult> {
  const db = getServiceClient();

  // Load provider config
  const { data: providers, error } = await db
    .from("host_auth_providers")
    .select("provider, jwks_url, audience, issuer")
    .eq("project_id", opts.projectId)
    .eq("enabled", true)
    .limit(5);

  if (error || !providers || providers.length === 0) {
    throw new Error(`No JWKS provider configured for project ${opts.projectId}`);
  }

  const { payload: rawPayload } = parseJwtUnsafe(opts.token);

  // Match provider by issuer claim in token
  let matchedProvider: ProviderConfig | null = null;
  for (const p of providers as ProviderConfig[]) {
    if (!p.issuer || rawPayload.iss === p.issuer) {
      matchedProvider = p;
      break;
    }
  }
  if (!matchedProvider) {
    throw new Error(`No provider matched issuer "${rawPayload.iss}" for project ${opts.projectId}`);
  }

  // Fetch + verify
  const keys = await getJwks(matchedProvider.jwks_url, db);
  const payload = await verifyJwtSignature(opts.token, keys);

  // Validate claims
  const now = Math.floor(Date.now() / 1_000);
  if (payload.exp !== undefined && payload.exp < now) {
    throw new Error("JWT has expired");
  }
  if (matchedProvider.audience) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(matchedProvider.audience)) {
      throw new Error(`JWT audience mismatch: expected "${matchedProvider.audience}"`);
    }
  }
  if (matchedProvider.issuer && payload.iss !== matchedProvider.issuer) {
    throw new Error(`JWT issuer mismatch: expected "${matchedProvider.issuer}"`);
  }
  if (!payload.sub) {
    throw new Error("JWT missing sub claim");
  }

  // Persist jwt_verified_at on end_users
  await db
    .from("end_users")
    .update({ jwt_verified_at: new Date().toISOString() })
    .eq("id", opts.endUserId);

  return { sub: payload.sub, provider: matchedProvider.provider, payload };
}

/**
 * isJwtVerified — quick check whether an end_user has a valid jwt_verified_at.
 * Monetary payout routes call this before enqueuing a payout.
 */
export async function isJwtVerified(endUserId: string): Promise<boolean> {
  const db = getServiceClient();
  const { data } = await db
    .from("end_users")
    .select("jwt_verified_at")
    .eq("id", endUserId)
    .maybeSingle();
  return Boolean(data?.jwt_verified_at);
}
