// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * Linear Agent session helpers.
 *
 * Supports Mushi as a Linear "Agent" — an assignable / @-mentionable AI
 * teammate (actor=app). Uses the app actor token stored in
 * project_settings.linear_actor_token_ref.
 *
 * Reference: https://linear.app/developers/agents
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { log as rootLog } from './logger.ts'
import { dereferenceMaybeVault } from './integration-probes.ts'

const log = rootLog.child('linear-agent')

const LINEAR_GRAPHQL = 'https://api.linear.app/graphql'

// ── Activity types as per Linear Agents API ───────────────────────────────────

export type LinearAgentActivityType =
  | 'thought'    // Internal thinking step (shown as collapsible)
  | 'text'       // Text response visible to users
  | 'toolCall'   // Representation of a tool/function call
  | 'result'     // Result of a tool call
  | 'error'      // Error encountered during processing

export interface AgentActivity {
  type: LinearAgentActivityType
  /** Markdown-formatted body text. */
  body: string
  /** Optional external URL (e.g. Mushi report URL, GitHub PR URL). */
  externalUrl?: string
}

// ── Token resolution ──────────────────────────────────────────────────────────

/**
 * Resolves the app actor token for agent mode. Falls back to the OAuth
 * access token if the actor token is not set (reduced agent capabilities).
 */
export async function getLinearActorToken(
  db: SupabaseClient,
  projectId: string,
): Promise<string | null> {
  const { data: ps } = await db
    .from('project_settings')
    .select('linear_actor_token_ref, linear_access_token_ref')
    .eq('project_id', projectId)
    .maybeSingle()

  if (ps?.linear_actor_token_ref) {
    const token = await dereferenceMaybeVault(db, ps.linear_actor_token_ref)
    if (token) return token
  }

  // Fallback: OAuth access token (fewer agent permissions but functional)
  if (ps?.linear_access_token_ref) {
    const token = await dereferenceMaybeVault(db, ps.linear_access_token_ref)
    if (token) return token
  }

  return null
}

// ── Agent session ─────────────────────────────────────────────────────────────

/**
 * Posts an activity to a Linear agent session.
 *
 * Must be called within 10 seconds for the first 'thought' acknowledgement
 * after receiving an AgentSessionEvent webhook — Linear considers the agent
 * unresponsive if no activity is received in that window.
 */
export async function postAgentActivity(
  actorToken: string,
  agentSessionId: string,
  activity: AgentActivity,
): Promise<void> {
  const MUTATION = `
    mutation AgentSessionCreateActivity(
      $agentSessionId: String!
      $type: AgentActivityType!
      $body: String!
      $externalUrl: String
    ) {
      agentSessionCreateActivity(
        agentSessionId: $agentSessionId
        type: $type
        body: $body
        externalUrl: $externalUrl
      ) {
        success
      }
    }
  `
  const res = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      Authorization: actorToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: MUTATION,
      variables: {
        agentSessionId,
        type: activity.type,
        body: activity.body,
        externalUrl: activity.externalUrl,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`postAgentActivity HTTP ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = await res.json() as {
    data?: { agentSessionCreateActivity?: { success: boolean } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(`agentSessionCreateActivity error: ${json.errors.map((e) => e.message).join('; ')}`)
  }
}

// ── Session context ───────────────────────────────────────────────────────────

export interface AgentSessionData {
  id: string
  issue: {
    id: string
    identifier: string
    title: string
    description: string | null
    url: string
    priority: number
    state: { name: string; type: string }
    assignee: { id: string; name: string } | null
  }
  promptContext: string | null
  createdAt: string
}

/**
 * Fetches the full context for a Linear agent session. Used by
 * webhooks-linear-agent to build context before dispatching to fix-worker.
 */
export async function getAgentSessionContext(
  actorToken: string,
  agentSessionId: string,
): Promise<AgentSessionData | null> {
  const QUERY = `
    query AgentSession($id: String!) {
      agentSession(id: $id) {
        id
        promptContext
        createdAt
        issue {
          id
          identifier
          title
          description
          url
          priority
          state { name type }
          assignee { id name }
        }
      }
    }
  `
  try {
    const res = await fetch(LINEAR_GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: actorToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { id: agentSessionId } }),
    })

    if (!res.ok) return null

    const json = await res.json() as { data?: { agentSession?: AgentSessionData } }
    return json.data?.agentSession ?? null
  } catch (err) {
    log.warn('getAgentSessionContext failed', { agentSessionId, err: String(err) })
    return null
  }
}
