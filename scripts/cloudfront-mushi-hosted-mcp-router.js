/**
 * CloudFront Function (viewer-request) — proxy /mushi-mushi/hosted-mcp/* to Supabase MCP.
 *
 * Metadata (PRM, AS, server-card) is served by the Supabase `mcp` edge function
 * (MCP_PUBLIC_BASE_URL) so HEAD responses include a JSON body — required by
 * Smithery RFC 8414 discovery. CloudFront Functions omit bodies on synthetic HEAD.
 *
 * POST/DELETE/OPTIONS/SSE GET → rewrite URI and forward to custom origin.
 */

var PREFIX = '/mushi-mushi/hosted-mcp'

function handler(event) {
  var request = event.request
  var uri = request.uri
  var method = request.method

  if (uri.indexOf(PREFIX) !== 0) {
    return request
  }

  var acceptHeader = request.headers['accept']
  var accept = acceptHeader && acceptHeader.value ? acceptHeader.value : ''
  var wantsSse = accept.indexOf('text/event-stream') >= 0

  var rest = uri.slice(PREFIX.length)
  if (!rest || rest === '') {
    rest = '/'
  } else if (rest.charAt(0) !== '/') {
    rest = '/' + rest
  }

  var isMetadataGet =
    (method === 'GET' || method === 'HEAD') &&
    (rest.indexOf('oauth-authorization-server') >= 0 ||
      rest.indexOf('openid-configuration') >= 0 ||
      rest.indexOf('oauth-protected-resource') >= 0 ||
      rest.indexOf('server-card.json') >= 0 ||
      (!wantsSse && (rest === '/' || rest === '')))

  if (isMetadataGet) {
    request.uri = rest
    return request
  }

  request.uri = rest
  return request
}
