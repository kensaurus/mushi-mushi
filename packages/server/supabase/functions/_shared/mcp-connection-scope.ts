/**
 * FILE: packages/server/supabase/functions/_shared/mcp-connection-scope.ts
 * PURPOSE: Which projects one hosted MCP connection acts on (ADR 0026).
 *
 *   - Account connection: an account key (or a console session) with no
 *     `?project=` pin reaches several projects. Tools take `projectId`, and
 *     list_projects / get_account_overview are always listed so the agent can
 *     find the ids, whatever `?features=` says.
 *   - Pinned connection: `?project=<uuid>` limits every call to one project,
 *     like Supabase's `?project_ref=`. A tool call naming another project is
 *     refused, and the account and organization-wide tools are hidden.
 *   - A key limited to selected projects does not list organization-wide
 *     tools either; the API refuses them for it.
 *
 * Pure helpers, kept out of mcp/index.ts so they are unit-tested.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Tools an account connection always lists: how the agent finds project ids. */
export const ACCOUNT_TOOLS: ReadonlySet<string> = new Set(['list_projects', 'get_account_overview'])

/**
 * Tools that act on a whole organization (/v1/admin/orgs/:orgId/*): they
 * reach every project in the team, so the API refuses them for a connection
 * narrowed to one project or to selected projects, and such a connection
 * does not list them.
 */
export const ORG_WIDE_TOOLS: ReadonlySet<string> = new Set([
  'get_portfolio',
  'list_portfolio_findings',
  'list_connectors',
  'propose_portfolio_change',
  'request_connector_action',
  'get_accounts_register',
  'save_register_account',
  'remove_register_account',
  'set_domain_auto_renew',
  'get_spend_ledger',
  'import_spend_bill',
  'remove_spend_import',
  'get_release_calendar',
])

export type PinParse = { ok: true; projectId: string | null } | { ok: false; message: string }

/** `?project=<uuid>` from the connection URL. Absent or blank → no pin. */
export function parsePinnedProject(url: URL): PinParse {
  const raw = url.searchParams.get('project')
  if (raw === null || raw.trim() === '') return { ok: true, projectId: null }
  const value = raw.trim().toLowerCase()
  if (!UUID_RE.test(value)) return { ok: false, message: '?project= must be a project UUID' }
  return { ok: true, projectId: value }
}

export interface ConnectionScope {
  accountMode?: boolean
  pinnedProjectId?: string
  /** An account key limited to selected projects (allowed_project_ids). */
  limitedToProjects?: boolean
}

/**
 * Whether `name` is listed and callable on this connection. `matchesFeatures`
 * is the ?features= filter; account tools pass it on an account connection
 * and are hidden on a pinned one.
 */
export function toolEnabledForConnection(
  name: string,
  scope: ConnectionScope,
  matchesFeatures: (name: string) => boolean,
): boolean {
  if (ORG_WIDE_TOOLS.has(name) && (scope.pinnedProjectId || scope.limitedToProjects)) return false
  if (ACCOUNT_TOOLS.has(name)) {
    if (scope.pinnedProjectId) return false
    if (scope.accountMode) return true
  }
  return matchesFeatures(name)
}

export type PinnedArgs = { ok: true; args: Record<string, unknown> } | { ok: false; message: string }

/**
 * Apply a connection's pin to one tool call's arguments: a tool that takes
 * projectId gets the pinned project, and naming a different one is refused.
 */
export function applyPinnedProject(
  args: Record<string, unknown>,
  pinnedProjectId: string | undefined,
  declaresProjectId: boolean,
): PinnedArgs {
  if (!pinnedProjectId) return { ok: true, args }
  const named = typeof args.projectId === 'string' ? args.projectId.trim().toLowerCase() : ''
  if (named && named !== pinnedProjectId) {
    return {
      ok: false,
      message: `This connection is limited to project ${pinnedProjectId} (?project= on the server URL); it cannot act on ${named}.`,
    }
  }
  return { ok: true, args: declaresProjectId ? { ...args, projectId: pinnedProjectId } : args }
}

/** Sentence appended to the server instructions on an account connection. */
export const ACCOUNT_MODE_INSTRUCTIONS =
  'This connection reaches several of your projects: call list_projects to see them, then pass projectId to project tools.'

/** Server instructions for this connection. */
export function instructionsForConnection(base: string, scope: ConnectionScope): string {
  return scope.accountMode ? `${base} ${ACCOUNT_MODE_INSTRUCTIONS}` : base
}

/**
 * A "projectId is required" tool error on an account connection, with the
 * next step: the agent cannot know there is no default project.
 */
export function withAccountModeHint(message: string, scope: ConnectionScope): string {
  if (!scope.accountMode) return message
  if (!/projectId is required|PROJECT_REQUIRED|reaches several projects/i.test(message)) return message
  if (message.includes('list_projects')) return message
  return `${message} — this connection reaches several projects: call list_projects and pass projectId.`
}
