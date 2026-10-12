/**
 * FILE: apps/admin/src/lib/mcpAuthProjects.ts
 * PURPOSE: Which projects the MCP consent page (/mcp-auth) may offer.
 *
 * QA bug 269: the picker listed every project the user can see, but a
 * project key needs owner/admin, so a member picked a project and got a 403.
 * And a failed projects load read as "No projects found", an empty account.
 * The one-project choice now offers only projects the user can manage, and a
 * failed load offers nothing (the page says so) rather than an empty account.
 */

export interface McpAuthProjectRow {
  id: string
  name: string
  /** Server-computed (GET /v1/admin/projects). Absent on older servers. */
  can_manage?: boolean
  organization_role?: string | null
}

function canConnect(p: McpAuthProjectRow): boolean {
  if (typeof p.can_manage === 'boolean') return p.can_manage
  // Older server: only a known owner/admin role is trusted.
  return p.organization_role === 'owner' || p.organization_role === 'admin'
}

/**
 * What one MCP connection reaches (ADR 0026):
 *   - 'account'  — every project the user can reach, now and later;
 *   - 'selected' — only the projects ticked on the consent page;
 *   - 'project'  — one project (a project key: owner/admin only).
 * Account and selected grants act with the user's own role in each project,
 * so any visible project may be granted; a project key acts as the project's
 * owner, so it stays limited to projects the user can manage.
 */
export type McpAuthAccess = 'account' | 'selected' | 'project'

export interface McpAuthAccessPlan {
  /** Every project the user can see, with their role in it. */
  visible: Array<{ id: string; name: string; role: string | null }>
  /** Projects a single-project key can be created for. */
  connectable: Array<{ id: string; name: string }>
  modes: McpAuthAccess[]
  defaultMode: McpAuthAccess | null
}

export function mcpAuthAccessPlan(
  res: { ok: boolean; data?: { projects?: McpAuthProjectRow[] } | null } | null,
): McpAuthAccessPlan {
  const all = res?.ok ? (res.data?.projects ?? []) : []
  const visible = all.map((p) => ({ id: p.id, name: p.name, role: p.organization_role ?? null }))
  const connectable = all.filter(canConnect).map((p) => ({ id: p.id, name: p.name }))
  if (visible.length === 0) return { visible, connectable, modes: [], defaultMode: null }
  const modes: McpAuthAccess[] = ['account', 'selected', ...(connectable.length > 0 ? (['project'] as const) : [])]
  // Several projects: one connection for all of them is what the user wants
  // (QA: "can only approve one project at a time"). One project: keep the
  // narrowest grant that works.
  const defaultMode: McpAuthAccess = visible.length > 1 || connectable.length === 0 ? 'account' : 'project'
  return { visible, connectable, modes, defaultMode }
}

/** POST /v1/mcp-oauth/approve body for the chosen access, or null while incomplete. */
export function mcpAuthApproveBody(
  txn: string,
  access: McpAuthAccess,
  choice: { projectId?: string; selectedIds?: readonly string[] },
): Record<string, unknown> | null {
  if (access === 'account') return { txn, access }
  if (access === 'selected') {
    const ids = [...new Set(choice.selectedIds ?? [])]
    return ids.length > 0 ? { txn, access, project_ids: ids } : null
  }
  return choice.projectId ? { txn, access, project_id: choice.projectId } : null
}

/** Scopes the minted key will carry: an account key never ingests reports. */
export function mcpAuthGrantedScopes(scopes: readonly string[], access: McpAuthAccess): string[] {
  if (access === 'project') return [...scopes]
  const agent = scopes.filter((s) => s === 'mcp:read' || s === 'mcp:write')
  return agent.length > 0 ? agent : ['mcp:read']
}
