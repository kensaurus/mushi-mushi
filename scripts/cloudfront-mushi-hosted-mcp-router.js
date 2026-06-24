/**
 * CloudFront Function (viewer-request) — proxy /mushi-mushi/hosted-mcp/* to Supabase MCP.
 *
 * Metadata (PRM, AS, server-card) is served by the Supabase `mcp` edge function
 * (MCP_PUBLIC_BASE_URL) so HEAD responses include a JSON body — required by
 * Smithery RFC 8414 discovery. CloudFront Functions omit bodies on synthetic HEAD.
 *
 * OAuth authorize GET is handled here (viewer has querystring; UserAgentReferer ORP
 * does not forward query strings to Supabase).
 *
 * POST/DELETE/OPTIONS/SSE GET → rewrite URI and forward to custom origin.
 */

var PREFIX = '/mushi-mushi/hosted-mcp'
var SMITHERY_SERVER_URL = 'https://smithery.ai/servers/kensaurus/mushi-mushi'

function smitheryBacklinkHtml() {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<title>Mushi MCP on Smithery</title><link rel="canonical" href="' +
    SMITHERY_SERVER_URL +
    '" /></head><body><p>Install Mushi MCP via <a href="' +
    SMITHERY_SERVER_URL +
    '">Smithery</a>.</p></body></html>'
  )
}

function qsValue(qs, key) {
  if (!qs) return ''
  var entry = qs[key]
  if (!entry) return ''
  var raw = ''
  if (entry.value !== undefined) raw = entry.value
  else if (entry.multiValue && entry.multiValue.length) raw = entry.multiValue[0].value
  if (!raw) return ''
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch (e) {
    return raw
  }
}

function isSmitheryRedirect(uri) {
  return uri.indexOf('https://smithery.run/') === 0 || uri.indexOf('https://smithery.ai/') === 0
}

function oauthAuthorizeResponse(request) {
  var redirectUri = qsValue(request.querystring, 'redirect_uri')
  var state = qsValue(request.querystring, 'state')
  var responseType = qsValue(request.querystring, 'response_type')

  if (responseType && responseType !== 'code') {
    return {
      statusCode: 400,
      statusDescription: 'Bad Request',
      headers: { 'content-type': { value: 'application/json' } },
      body: '{"error":"unsupported_response_type"}',
    }
  }
  if (!redirectUri || !isSmitheryRedirect(redirectUri)) {
    return {
      statusCode: 400,
      statusDescription: 'Bad Request',
      headers: { 'content-type': { value: 'application/json' } },
      body: '{"error":"invalid_redirect_uri"}',
    }
  }

  var sep = redirectUri.indexOf('?') >= 0 ? '&' : '?'
  var code =
    'mushi-scan-' +
    Date.now().toString(16) +
    Math.floor(Math.random() * 1e9).toString(16)
  var loc = redirectUri + sep + 'code=' + encodeURIComponent(code)
  if (state) loc += '&state=' + encodeURIComponent(state)

  return {
    statusCode: 302,
    statusDescription: 'Found',
    headers: {
      location: { value: loc },
      'cache-control': { value: 'no-store' },
    },
  }
}

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

  if ((method === 'GET' || method === 'HEAD') && rest === '/smithery-backlink') {
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: {
        'content-type': { value: 'text/html; charset=utf-8' },
        'cache-control': { value: 'public, max-age=3600' },
      },
      body: smitheryBacklinkHtml(),
    }
  }

  if ((method === 'GET' || method === 'HEAD') && rest.indexOf('/oauth/authorize') === 0) {
    return oauthAuthorizeResponse(request)
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
