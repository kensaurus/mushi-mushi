/**
 * FILE: packages/server/supabase/functions/mcp/hosted-resources.ts
 * PURPOSE: Where each MCP resource the catalog declares is read from, on the
 *          hosted transport. The stdio server registers the same eight URIs
 *          (packages/mcp/src/server.ts); resources/list takes names and
 *          descriptions from the generated catalog (mcp-discovery-tools.json)
 *          and this table supplies the API route behind each URI.
 *
 *          Hosted used to list four of the eight and to expose the rest as
 *          resource-shaped *tools* in mcp-hosted-tool-manifest.json
 *          (project_dashboard, privacy_status, …), which stdio never had and
 *          which crowded ?features=all. Resources are resources again.
 *
 *          Pure (no Deno or network access) so the vitest suite can check
 *          that every catalog URI resolves.
 */

/** API route for a resource read, or why the read cannot be served. */
export type HostedResourceTarget = { path: string } | { error: string }

const NEEDS_PROJECT = 'requires a project context; send the X-Mushi-Project-Id header or connect with a project-bound key'

/** Every resource URI the hosted server can read, in catalog order. */
export const HOSTED_RESOURCE_URIS = [
  'project://dashboard',
  'project://stats',
  'project://settings',
  'privacy://status',
  'evolution://history',
  'mushi://activation',
  'project://integration-health',
  'inventory://current',
] as const

/**
 * Resolve a resource URI to the api route that serves it. Returns null for a
 * URI this server does not know, and `{ error }` when the URI needs a project
 * the connection does not carry.
 */
export function hostedResourceTarget(uri: string, projectIdHint?: string): HostedResourceTarget | null {
  const pid = projectIdHint ? encodeURIComponent(projectIdHint) : null
  switch (uri) {
    case 'project://dashboard':
      return { path: '/v1/admin/dashboard' }
    case 'project://stats':
      return { path: '/v1/admin/stats' }
    case 'project://settings':
      return { path: '/v1/admin/settings' }
    case 'privacy://status':
      return { path: '/v1/admin/privacy-status' }
    case 'evolution://history':
      return pid ? { path: `/v1/admin/projects/${pid}/evolution-history` } : { error: `${uri} ${NEEDS_PROJECT}` }
    case 'mushi://activation':
      return { path: pid ? `/v1/admin/activation?project_id=${pid}` : '/v1/admin/activation' }
    case 'project://integration-health':
      return { path: '/v1/admin/integrations/health' }
    case 'inventory://current':
      return pid ? { path: `/v1/admin/inventory/${pid}` } : { error: `${uri} ${NEEDS_PROJECT}` }
    default:
      return null
  }
}
