/**
 * Optional Cloudflare Worker for mcp.kensaur.us — serves RFC 9728 PRM at the
 * Supabase-origin path Smithery probes, then proxies MCP to Supabase.
 *
 * Deploy: wrangler deploy (see docs/marketing/smithery-external-publish.json)
 * DNS: mcp.kensaur.us → Cloudflare Worker (not direct Supabase CNAME)
 *
 * Smithery upstream URL after deploy:
 *   https://mcp.kensaur.us/
 */

const SUPABASE_MCP = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp'

function protectedResourceJson(origin, resourcePath = '/') {
  const base = `${origin.replace(/\/+$/, '')}${resourcePath === '/' ? '' : resourcePath.replace(/\/+$/, '')}`
  const resource = resourcePath === '/' ? `${origin.replace(/\/+$/, '')}/` : `${base}/`
  const issuer = origin.replace(/\/+$/, '')
  return JSON.stringify({
    resource,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
    resource_documentation: 'https://kensaur.us/mushi-mushi/docs/quickstart/mcp',
  })
}

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      const suffix = url.pathname.replace('/.well-known/oauth-protected-resource', '') || '/'
      const body = protectedResourceJson(url.origin, suffix)
      return new Response(request.method === 'HEAD' ? null : body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    const target = new URL(SUPABASE_MCP)
    if (url.search) target.search = url.search

    const headers = new Headers(request.headers)
    const init = {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'follow',
    }
    return fetch(target.toString(), init)
  },
}
