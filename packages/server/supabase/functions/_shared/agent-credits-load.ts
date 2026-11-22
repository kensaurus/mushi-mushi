/**
 * FILE: packages/server/supabase/functions/_shared/agent-credits-load.ts
 * PURPOSE: The reads behind agent-credits.ts: the newest fix runs of some
 *          apps, the Cursor keys that serve them, and an app's fix agent,
 *          provider and keys for the dispatch preflight.
 *
 *          Every read that fails reads as "not out of credits" / "not
 *          checked": this adds a truthful line to a page, it never breaks one.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { resolveLlmKey, resolveLlmKeys } from './byok.ts'
import { aiProviderForProject } from './ai-provider.ts'
import { ownerUserColumnReady, withOwnerUserColumn } from './byok-scope.ts'
import {
  agentCreditsState,
  fixAgentCheck,
  fixAgentKind,
  NO_CREDITS_STATE,
  type AgentCreditsState,
  type CreditAttemptRow,
  type CreditKeyRow,
  type PreflightAgentCheck,
} from './agent-credits.ts'

/** How far back the newest runs are read. */
const ATTEMPT_LOOKBACK_MS = 14 * 86_400_000
const ATTEMPT_LIMIT = 40

interface KeyRowDb {
  label: string | null
  status: string
  exhausted_until: string | null
  credits_expire_at: string | null
  created_at?: string | null
  project_id?: string | null
  organization_id?: string | null
  owner_user_id?: string | null
}

const toKey = (k: KeyRowDb): CreditKeyRow => ({
  label: k.label,
  status: k.status,
  exhaustedUntil: k.exhausted_until ?? null,
  creditsExpireAt: k.credits_expire_at ?? null,
  createdAt: k.created_at ?? null,
})

/** The newest fix runs of these apps (any agent), newest first. */
async function recentAttempts(db: SupabaseClient, projectIds: readonly string[], now: Date): Promise<CreditAttemptRow[]> {
  if (projectIds.length === 0) return []
  const { data, error } = await db
    .from('fix_attempts')
    .select('agent, status, error, created_at')
    .in('project_id', [...projectIds].slice(0, 500))
    .gte('created_at', new Date(now.getTime() - ATTEMPT_LOOKBACK_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(ATTEMPT_LIMIT)
  if (error) return []
  return ((data ?? []) as Array<{ agent: string | null; status: string | null; error: string | null; created_at: string }>).map((a) => ({
    agent: a.agent,
    status: a.status,
    error: a.error,
    createdAt: a.created_at,
  }))
}

/** Cursor keys the caller sees: their apps', their apps' organizations', or their own universal keys. */
async function visibleCursorKeys(db: SupabaseClient, userId: string | null, projectIds: readonly string[]): Promise<CreditKeyRow[]> {
  if (projectIds.length === 0) return []
  const { data: projects } = await db.from('projects').select('id, organization_id').in('id', [...projectIds].slice(0, 500))
  const orgs = new Set(((projects ?? []) as Array<{ organization_id: string | null }>).map((p) => p.organization_id).filter((x): x is string => !!x))
  const apps = new Set(projectIds)
  const ready = await ownerUserColumnReady(db)
  const { data, error } = await db
    .from('byok_keys')
    .select(withOwnerUserColumn('label, status, exhausted_until, credits_expire_at, created_at, project_id, organization_id', ready))
    .eq('provider_slug', 'cursor')
    .limit(100)
  if (error) return []
  return ((data ?? []) as unknown as KeyRowDb[])
    .filter((k) => (k.project_id && apps.has(k.project_id)) || (k.organization_id && orgs.has(k.organization_id)) || (!!userId && k.owner_user_id === userId))
    .map(toKey)
}

/** Do the agents that open fixes on their own have credits, across these apps? */
export async function loadAgentCredits(db: SupabaseClient, userId: string | null, projectIds: readonly string[], now: Date): Promise<AgentCreditsState> {
  try {
    const [keys, attempts] = await Promise.all([visibleCursorKeys(db, userId, projectIds), recentAttempts(db, projectIds, now)])
    return agentCreditsState({ keys, attempts, now })
  } catch {
    return NO_CREDITS_STATE
  }
}

/** The Cursor keys that serve one app (the resolver's pool), with their used-up dates. */
async function projectCursorKeys(db: SupabaseClient, projectId: string): Promise<CreditKeyRow[]> {
  const pool = await resolveLlmKeys(db, projectId, 'cursor').catch(() => [])
  const ids = pool.map((k) => k.keyId).filter((x): x is string => !!x)
  if (ids.length === 0) return []
  const { data, error } = await db.from('byok_keys').select('label, status, exhausted_until, credits_expire_at, created_at').in('id', ids)
  if (error) return []
  return ((data ?? []) as KeyRowDb[]).map(toKey)
}

/**
 * The dispatch preflight's agent line for one app: the agent its fixes run
 * on (`autofix_agent`), and that agent's key. A probe, never a generation:
 * no budget check, no call to the provider.
 */
export async function loadFixAgentCheck(db: SupabaseClient, projectId: string, autofixAgent: string | null, now: Date): Promise<PreflightAgentCheck> {
  const agent = fixAgentKind(autofixAgent)
  const [aiProvider, anthropic, openai, cursorKeys] = await Promise.all([
    aiProviderForProject(db, projectId),
    agent === 'llm' ? resolveLlmKey(db, projectId, 'anthropic', { purpose: 'probe' }).catch(() => null) : Promise.resolve(null),
    agent === 'llm' ? resolveLlmKey(db, projectId, 'openai', { purpose: 'probe' }).catch(() => null) : Promise.resolve(null),
    agent === 'cursor_cloud' ? projectCursorKeys(db, projectId) : Promise.resolve([] as CreditKeyRow[]),
  ])
  return fixAgentCheck(
    { autofixAgent, aiProvider, hasAnthropicKey: Boolean(anthropic?.key), hasOpenaiKey: Boolean(openai?.key), cursorKeys },
    now,
  )
}
