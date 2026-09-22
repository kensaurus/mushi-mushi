/**
 * CloudFront Function (viewer-request) — origin-level OAuth discovery for the
 * hosted MCP at https://kensaur.us/mushi-mushi/hosted-mcp.
 *
 * Serves, on the kensaur.us ORIGIN (path-inserted well-known URIs):
 *   /.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp   RFC 9728 PRM
 *   /.well-known/oauth-authorization-server/mushi-mushi/hosted-mcp RFC 8414 AS
 *
 * Why the AS document lives here: the official MCP SDK's
 * discoverAuthorizationServerMetadata tries the RFC 8414 path-inserted URL
 * FIRST and parses it with the lenient OAuth schema. When it 404'd, the SDK
 * fell through to the path-appended openid-configuration, parsed it with the
 * strict OIDC schema, threw, and OAuth stopped before client registration —
 * for every client, on both published URLs (their PRM names this issuer).
 *
 * Each document is only valid for the resource/issuer identifier it was
 * inserted into (RFC 9728 §3.3, RFC 8414 §3.3), so the `resource` keeps a
 * trailing slash only when the request did. The SDK strips the slash before
 * inserting, so it always gets the slashless form, which its prefix check
 * accepts for server URLs with or without a trailing slash.
 *
 * Values must stay in sync with scripts/hosted-mcp-oauth-metadata.json (a test
 * enforces it) and with what the `mcp` edge function serves under
 * MCP_PUBLIC_BASE_URL. Operational endpoints are on the Supabase origin on
 * purpose: see _shared/mcp-oauth-metadata.ts.
 *
 * Attached to two cache behaviors (see scripts/aws-setup-hosted-mcp.mjs).
 */

var RESOURCE = 'https://kensaur.us/mushi-mushi/hosted-mcp'
var FN_BASE = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp'
var PRM_PREFIX = '/.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp'
var AS_PREFIX = '/.well-known/oauth-authorization-server/mushi-mushi/hosted-mcp'

var AS_METADATA = JSON.stringify({
  issuer: RESOURCE,
  authorization_endpoint: FN_BASE + '/oauth/authorize',
  token_endpoint: FN_BASE + '/oauth/token',
  registration_endpoint: FN_BASE + '/oauth/register',
  jwks_uri: RESOURCE + '/.well-known/jwks.json',
  scopes_supported: ['mcp:read', 'mcp:write'],
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'client_credentials'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  code_challenge_methods_supported: ['S256'],
  // RFC 9207: authorization responses carry iss (api/routes/mcp-oauth.ts).
  authorization_response_iss_parameter_supported: true,
})

function prmFor(uri) {
  return JSON.stringify({
    resource: uri.charAt(uri.length - 1) === '/' ? RESOURCE + '/' : RESOURCE,
    authorization_servers: [RESOURCE],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    resource_documentation: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
  })
}

function json(statusCode, statusDescription, body) {
  // HEAD gets the same headers; CloudFront drops the body on synthetic HEAD.
  return {
    statusCode: statusCode,
    statusDescription: statusDescription,
    headers: {
      'content-type': { value: 'application/json' },
      'cache-control': { value: statusCode === 200 ? 'public, max-age=3600' : 'no-store' },
      'access-control-allow-origin': { value: '*' },
    },
    body: body,
  }
}

function isUnder(uri, prefix) {
  return uri === prefix || uri === prefix + '/'
}

function handler(event) {
  var uri = event.request.uri
  if (isUnder(uri, PRM_PREFIX)) return json(200, 'OK', prmFor(uri))
  if (isUnder(uri, AS_PREFIX)) return json(200, 'OK', AS_METADATA)
  // The behavior patterns end in `*`, so a longer path can land here. A 404
  // lets discovery clients move on instead of parsing the wrong document.
  return json(404, 'Not Found', '{"error":"not_found"}')
}
