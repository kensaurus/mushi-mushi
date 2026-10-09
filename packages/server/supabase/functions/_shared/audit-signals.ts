/**
 * FILE: packages/server/supabase/functions/_shared/audit-signals.ts
 * PURPOSE: One definition of the audit console's groupings, shared by the
 *          stats route (banner counts, actor mix) and the log route (the
 *          filters those counts link to), so a number and the list it opens
 *          can never disagree.
 *
 *          - Outcomes: which actions count as failures / warnings.
 *          - Actor kinds: read from the `actor_type` column every writer
 *            sets (logAudit defaults to 'user'). The old rules matched
 *            `actor_id LIKE 'agent_%'`, but actor_id is a uuid column, so
 *            the agent and system filters always errored (shown as "No
 *            entries match") and system rows with an e-mail counted as human.
 *          - Search: comma-separated terms, OR'd, with PostgREST
 *            metacharacters stripped (a comma used to break the filter).
 */

export const AUDIT_FAIL_ACTIONS = ['fix.failed', 'integration.disconnected'] as const
export const AUDIT_WARN_ACTIONS = ['api_key.revoked', 'plugin.uninstalled'] as const

type AuditOutcome = 'failure' | 'warning'

export function parseAuditOutcome(raw: string | null | undefined): AuditOutcome | null {
  return raw === 'failure' || raw === 'warning' ? raw : null
}

export function outcomeActions(outcome: AuditOutcome): readonly string[] {
  return outcome === 'failure' ? AUDIT_FAIL_ACTIONS : AUDIT_WARN_ACTIONS
}

/** actor_type values written by people (directly or through a surface they drive). */
export const HUMAN_ACTOR_TYPES = ['user', 'console', 'cli', 'slack'] as const
/** actor_type values written by LLM agents and API-key (MCP) callers. */
export const AGENT_ACTOR_TYPES = ['agent', 'api_key'] as const

type AuditActorKind = 'human' | 'agent' | 'system'

export function parseAuditActorKind(raw: string | null | undefined): AuditActorKind | null {
  return raw === 'human' || raw === 'agent' || raw === 'system' ? raw : null
}

/** PostgREST `in` list literal, e.g. `(user,console)`. */
export function postgrestList(values: readonly string[]): string {
  return `(${values.join(',')})`
}

const MAX_TERMS = 5
const MAX_TERM_LENGTH = 64

/**
 * Split a search box value into safe terms: comma-separated, trimmed, and
 * stripped of everything but letters, digits and `._-@/` plus inner spaces,
 * so no term can inject a PostgREST operator or break the `or=` list.
 */
export function auditSearchTerms(q: string | null | undefined): string[] {
  if (!q) return []
  const out: string[] = []
  for (const raw of q.split(',')) {
    const term = raw.replace(/[^\p{L}\p{N}._\-@/ ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_LENGTH)
    if (term && !out.includes(term)) out.push(term)
    if (out.length >= MAX_TERMS) break
  }
  return out
}

/** The `or=` filter matching any term in action, resource type or resource id. */
export function auditSearchFilter(terms: readonly string[]): string | null {
  if (terms.length === 0) return null
  return terms
    .flatMap((t) => [`action.ilike.%${t}%`, `resource_type.ilike.%${t}%`, `resource_id.ilike.%${t}%`])
    .join(',')
}
