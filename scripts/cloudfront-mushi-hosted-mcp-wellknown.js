/**
 * CloudFront Function (viewer-request) — RFC 9728 origin PRM for Smithery.
 *
 * Serves Protected Resource Metadata at:
 *   /.well-known/oauth-protected-resource/mushi-mushi/hosted-mcp
 *
 * Smithery probes this path on the kensaur.us origin before scanning tools.
 * Values must stay in sync with scripts/hosted-mcp-oauth-metadata.json
 */

var PRM =
  '{"resource":"https://kensaur.us/mushi-mushi/hosted-mcp/","authorization_servers":["https://kensaur.us/mushi-mushi/hosted-mcp"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:read","mcp:write"],"resource_documentation":"https://kensaur.us/mushi-mushi/docs/quickstart/mcp"}';

function handler(event) {
  var request = event.request
  // Smithery OAuth discovery uses HEAD — include JSON body (RFC 8414 issuer parse).
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'application/json' },
      'cache-control': { value: 'public, max-age=3600' },
      'access-control-allow-origin': { value: '*' },
    },
    body: PRM,
  }
}
