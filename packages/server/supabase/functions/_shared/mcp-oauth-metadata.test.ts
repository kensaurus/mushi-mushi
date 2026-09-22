import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Module reads MCP_PUBLIC_BASE_URL per call (not at import time), so tests can
// toggle it between cases. The CI gate for these documents is the vitest
// suite (packages/server/src/__tests__/mcp-oauth-metadata.test.ts and the SDK
// discovery run in packages/mcp); deno-check.yml does not run _shared tests.
const {
  buildJwksDocument,
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
  buildOpenIdProviderMetadata,
} = await import('./mcp-oauth-metadata.ts');

// Inside the edge runtime req.url carries /mcp, not /functions/v1/mcp.
const AS_URL = new URL('http://edge-runtime.internal/mcp/.well-known/oauth-authorization-server');
const FN_BASE = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp';
const DIRECT = new Headers();
const VIA_CLOUDFRONT = new Headers({ 'x-amz-cf-id': 'fixture' });

function withEnv(vars: Record<string, string>, fn: () => void): void {
  for (const [k, v] of Object.entries(vars)) Deno.env.set(k, v);
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) Deno.env.delete(k);
  }
}

Deno.test('AS metadata advertises jwks_uri as a string (strict-client zod schemas require it)', () => {
  withEnv({ SUPABASE_URL: 'https://dxptnwrhwsqckaftyymj.supabase.co' }, () => {
    const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(AS_URL, DIRECT));
    assertEquals(typeof meta.jwks_uri, 'string');
    assertEquals(meta.jwks_uri, `${meta.issuer}/.well-known/jwks.json`);
    // Fallback-triggering absence was the bug: clients that discard invalid
    // metadata POST DCR to the origin root, which 404s on Supabase.
    assertStringIncludes(meta.registration_endpoint, '/oauth/register');
  });
});

Deno.test('direct requests describe the Supabase URL even when the proxy base is set', () => {
  withEnv(
    { SUPABASE_URL: 'https://dxptnwrhwsqckaftyymj.supabase.co', MCP_PUBLIC_BASE_URL: 'https://kensaur.us/mushi-mushi/hosted-mcp/' },
    () => {
      const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(AS_URL, DIRECT));
      assertEquals(meta.issuer, FN_BASE);
      const prm = JSON.parse(
        buildOAuthProtectedResourceMetadata(new URL('http://edge-runtime.internal/mcp/.well-known/oauth-protected-resource'), DIRECT),
      );
      assertEquals(prm.resource, FN_BASE);
    },
  );
});

Deno.test('proxied requests describe MCP_PUBLIC_BASE_URL; operational endpoints stay on Supabase', () => {
  // The CloudFront viewer-request fn used to 400 every non-Smithery
  // /oauth/authorize — real clients must never depend on the CDN for the
  // authorize/token/register hops.
  withEnv(
    { SUPABASE_URL: 'https://dxptnwrhwsqckaftyymj.supabase.co', MCP_PUBLIC_BASE_URL: 'https://kensaur.us/mushi-mushi/hosted-mcp/' },
    () => {
      const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(AS_URL, VIA_CLOUDFRONT));
      assertEquals(meta.issuer, 'https://kensaur.us/mushi-mushi/hosted-mcp');
      assertEquals(meta.jwks_uri, 'https://kensaur.us/mushi-mushi/hosted-mcp/.well-known/jwks.json');
      assertEquals(meta.authorization_endpoint, `${FN_BASE}/oauth/authorize`);
      assertEquals(meta.token_endpoint, `${FN_BASE}/oauth/token`);
      assertEquals(meta.registration_endpoint, `${FN_BASE}/oauth/register`);
    },
  );
});

Deno.test('openid-configuration carries the members the SDK OpenID provider schema requires', () => {
  withEnv({ SUPABASE_URL: 'https://dxptnwrhwsqckaftyymj.supabase.co' }, () => {
    const oidc = JSON.parse(buildOpenIdProviderMetadata(AS_URL, DIRECT));
    assertEquals(oidc.subject_types_supported, ['public']);
    assertEquals(oidc.id_token_signing_alg_values_supported, ['RS256']);
  });
});

Deno.test('JWKS document is a valid empty key set (opaque API-key tokens, no JWTs)', () => {
  const jwks = JSON.parse(buildJwksDocument());
  assertEquals(jwks, { keys: [] });
});
