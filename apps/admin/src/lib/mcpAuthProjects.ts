/**
 * FILE: apps/admin/src/lib/mcpAuthProjects.ts
 * PURPOSE: Which projects the MCP consent page (/mcp-auth) may offer.
 *
 * QA bug 269: the picker listed every project the user can see, but the
 * consent route mints a key and needs owner/admin, so a member picked a
 * project and got a 403. And a failed projects load read as "No projects
 * found", an empty account. The picker now offers only projects the user
 * can connect and tells the three cases apart.
 */

export interface McpAuthProjectRow {
  id: string
  name: string
  /** Server-computed (GET /v1/admin/projects). Absent on older servers. */
  can_manage?: boolean
  organization_role?: string | null
}

export type McpAuthProjectChoice =
  | { kind: 'load-failed' }
  | { kind: 'none' }
  | { kind: 'no-access'; visibleCount: number }
  | { kind: 'ok'; projects: Array<{ id: string; name: string }> }

function canConnect(p: McpAuthProjectRow): boolean {
  if (typeof p.can_manage === 'boolean') return p.can_manage
  // Older server: only a known owner/admin role is trusted.
  return p.organization_role === 'owner' || p.organization_role === 'admin'
}

export function mcpAuthProjectChoice(
  res: { ok: boolean; data?: { projects?: McpAuthProjectRow[] } | null } | null,
): McpAuthProjectChoice {
  if (!res || !res.ok) return { kind: 'load-failed' }
  const all = res.data?.projects ?? []
  if (all.length === 0) return { kind: 'none' }
  const usable = all.filter(canConnect).map((p) => ({ id: p.id, name: p.name }))
  if (usable.length === 0) return { kind: 'no-access', visibleCount: all.length }
  return { kind: 'ok', projects: usable }
}
