/**
 * CloudFront Function (viewer-request) — proxy /mushi-mushi/hosted-mcp/* to Supabase MCP.
 *
 * Metadata (PRM, AS, server-card) is served by the Supabase `mcp` edge function
 * (MCP_PUBLIC_BASE_URL) so HEAD responses include a JSON body — required by
 * Smithery RFC 8414 discovery. CloudFront Functions omit bodies on synthetic HEAD.
 *
 * OAuth authorize GET is handled here (viewer has querystring; UserAgentReferer ORP
 * does not forward query strings to Supabase). Smithery's publisher scan gets
 * the stub redirect at the edge; every REAL MCP client (claude mcp login,
 * Cursor — loopback redirect URIs) is 302'd to the api function's authorize
 * endpoint with the query string reassembled, which validates and forwards to
 * the console consent page.
 *
 * POST/DELETE/OPTIONS/SSE GET → rewrite URI and forward to custom origin.
 */

var PREFIX = '/mushi-mushi/hosted-mcp'
var SMITHERY_SERVER_URL = 'https://smithery.ai/servers/kensaurus/mushi-mushi'
var SUPABASE_HOST = 'dxptnwrhwsqckaftyymj.supabase.co'
var API_AUTHORIZE_URL = 'https://' + SUPABASE_HOST + '/functions/v1/api/v1/mcp-oauth/authorize'

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

/** Reassemble the raw query string (values stay URL-encoded as received). */
function rawQueryString(qs) {
  if (!qs) return ''
  var parts = []
  for (var key in qs) {
    var entry = qs[key]
    if (!entry) continue
    if (entry.multiValue && entry.multiValue.length) {
      for (var i = 0; i < entry.multiValue.length; i++) {
        parts.push(key + '=' + (entry.multiValue[i].value || ''))
      }
    } else {
      parts.push(key + '=' + (entry.value || ''))
    }
  }
  return parts.join('&')
}

function oauthAuthorizeResponse(request) {
  var redirectUri = qsValue(request.querystring, 'redirect_uri')
  var state = qsValue(request.querystring, 'state')
  var responseType = qsValue(request.querystring, 'response_type')

  // Real MCP clients (loopback/https redirect URIs) never terminate at the
  // edge: hand them to the api function's authorize endpoint, query intact,
  // where RFC 6749/PKCE validation lives. The edge must NOT 400 here — that
  // regression broke `claude mcp login` for every non-Smithery client.
  if (!redirectUri || !isSmitheryRedirect(redirectUri)) {
    var qs = rawQueryString(request.querystring)
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: { value: API_AUTHORIZE_URL + (qs ? '?' + qs : '') },
        'cache-control': { value: 'no-store' },
      },
    }
  }

  // Smithery publisher scan: stub redirect at the edge.
  if (responseType && responseType !== 'code') {
    return {
      statusCode: 400,
      statusDescription: 'Bad Request',
      headers: { 'content-type': { value: 'application/json' } },
      body: '{"error":"unsupported_response_type","error_description":"Only response_type=code is supported for publisher scan"}',
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
