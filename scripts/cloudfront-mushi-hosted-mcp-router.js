/**
 * CloudFront Function (viewer-request) — proxy /mushi-mushi/hosted-mcp/* to Supabase MCP.
 *
 * - GET/HEAD metadata (PRM, AS, server-card) → synthesized JSON (kensaur.us URLs)
 * - POST/DELETE/OPTIONS/SSE GET → rewrite URI and forward to custom origin
 *   (origin path /functions/v1/mcp on dxptnwrhwsqckaftyymj.supabase.co)
 */

var PREFIX = '/mushi-mushi/hosted-mcp';

var PRM =
  '{"resource":"https://kensaur.us/mushi-mushi/hosted-mcp/","authorization_servers":["https://kensaur.us/mushi-mushi/hosted-mcp"],"bearer_methods_supported":["header"],"scopes_supported":["mcp:read","mcp:write"],"resource_documentation":"https://kensaur.us/mushi-mushi/docs/quickstart/mcp"}';

var AS =
  '{"issuer":"https://kensaur.us/mushi-mushi/hosted-mcp","authorization_endpoint":"https://kensaur.us/mushi-mushi/docs/connect","token_endpoint":"https://kensaur.us/mushi-mushi/hosted-mcp/oauth/token","registration_endpoint":"https://kensaur.us/mushi-mushi/hosted-mcp/oauth/register","scopes_supported":["mcp:read","mcp:write"],"response_types_supported":["token"],"grant_types_supported":["client_credentials"],"token_endpoint_auth_methods_supported":["client_secret_post","none"]}';

function jsonResponse(body, method) {
  var headers = {
    'content-type': { value: 'application/json' },
    'cache-control': { value: 'public, max-age=3600' },
    'access-control-allow-origin': { value: '*' },
  }
  // Smithery OAuth discovery uses HEAD (RFC 8414) — body required for issuer parse.
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: headers,
    body: body,
  }
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var method = request.method;

  if (uri.indexOf(PREFIX) !== 0) {
    return request;
  }

  var acceptHeader = request.headers['accept'];
  var accept = acceptHeader && acceptHeader.value ? acceptHeader.value : '';
  var wantsSse = accept.indexOf('text/event-stream') >= 0;

  if (method === 'GET' || method === 'HEAD') {
    if (uri.indexOf('oauth-authorization-server') >= 0) {
      return jsonResponse(AS, method);
    }
    if (uri.indexOf('oauth-protected-resource') >= 0) {
      return jsonResponse(PRM, method);
    }
    if (!wantsSse && (uri === PREFIX || uri === PREFIX + '/')) {
      return jsonResponse(PRM, method);
    }
  }

  var rest = uri.slice(PREFIX.length);
  if (!rest || rest === '') {
    rest = '/';
  } else if (rest.charAt(0) !== '/') {
    rest = '/' + rest;
  }
  request.uri = rest;
  return request;
}
