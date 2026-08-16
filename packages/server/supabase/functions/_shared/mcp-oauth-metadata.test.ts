import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Module reads MCP_PUBLIC_BASE_URL per call (not at import time), so tests can
// toggle it between cases.
const {
  buildJwksDocument,
  buildOAuthAuthorizationServerMetadata,
  buildOAuthProtectedResourceMetadata,
} = await import('./mcp-oauth-metadata.ts');

const SUPA_URL = new URL(
  'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp/.well-known/oauth-authorization-server',
);

Deno.test('AS metadata advertises jwks_uri as a string (strict-client zod schemas require it)', () => {
  Deno.env.delete('MCP_PUBLIC_BASE_URL');
  const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(SUPA_URL));
  assertEquals(typeof meta.jwks_uri, 'string');
  assertEquals(meta.jwks_uri, `${meta.issuer}/.well-known/jwks.json`);
  // Fallback-triggering absence was the bug: clients that discard invalid
  // metadata POST DCR to the origin root, which 404s on Supabase.
  assertStringIncludes(meta.registration_endpoint, '/oauth/register');
});

Deno.test('AS metadata jwks_uri follows MCP_PUBLIC_BASE_URL when the proxy base is set', () => {
  Deno.env.set('MCP_PUBLIC_BASE_URL', 'https://kensaur.us/mushi-mushi/hosted-mcp/');
  try {
    const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(SUPA_URL));
    assertEquals(meta.issuer, 'https://kensaur.us/mushi-mushi/hosted-mcp');
    assertEquals(meta.jwks_uri, 'https://kensaur.us/mushi-mushi/hosted-mcp/.well-known/jwks.json');
  } finally {
    Deno.env.delete('MCP_PUBLIC_BASE_URL');
  }
});

Deno.test('operational OAuth endpoints stay on the Supabase origin even behind the proxy base', () => {
  // The CloudFront viewer-request fn used to 400 every non-Smithery
  // /oauth/authorize — real clients must never depend on the CDN for the
  // authorize/token/register hops.
  Deno.env.set('MCP_PUBLIC_BASE_URL', 'https://kensaur.us/mushi-mushi/hosted-mcp');
  Deno.env.set('SUPABASE_URL', 'https://dxptnwrhwsqckaftyymj.supabase.co');
  try {
    const meta = JSON.parse(buildOAuthAuthorizationServerMetadata(SUPA_URL));
    const fnBase = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp';
    assertEquals(meta.authorization_endpoint, `${fnBase}/oauth/authorize`);
    assertEquals(meta.token_endpoint, `${fnBase}/oauth/token`);
    assertEquals(meta.registration_endpoint, `${fnBase}/oauth/register`);
  } finally {
    Deno.env.delete('MCP_PUBLIC_BASE_URL');
    Deno.env.delete('SUPABASE_URL');
  }
});

Deno.test('JWKS document is a valid empty key set (opaque API-key tokens, no JWTs)', () => {
  const jwks = JSON.parse(buildJwksDocument());
  assertEquals(jwks, { keys: [] });
});

Deno.test('protected resource metadata still aligns resource with issuer', () => {
  Deno.env.delete('MCP_PUBLIC_BASE_URL');
  const prm = JSON.parse(
    buildOAuthProtectedResourceMetadata(
      new URL('https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource'),
    ),
  );
  assertEquals(prm.authorization_servers.length, 1);
  assertStringIncludes(prm.resource, prm.authorization_servers[0]);
});
