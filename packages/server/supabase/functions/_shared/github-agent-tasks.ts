// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto (kensaurus) — Mushi Mushi
/**
 * FILE: packages/server/supabase/functions/_shared/github-agent-tasks.ts
 * PURPOSE: GitHub Copilot cloud agent — "Agent Tasks" REST client.
 *          https://docs.github.com/en/rest/agent-tasks/agent-tasks
 *
 *            POST /agents/repos/{owner}/{repo}/tasks
 *                 { prompt, create_pull_request: true, base_ref?, head_ref?,
 *                   model?, custom_agent? }                         → 201 Task
 *            GET  /agents/repos/{owner}/{repo}/tasks/{task_id}       → Task
 *            GET  /agents/tasks/{task_id}                            → Task
 *            Header  X-GitHub-Api-Version: 2026-03-10  (public preview)
 *            state ∈ queued | in_progress | completed | failed | idle |
 *                    waiting_for_user | timed_out | cancelled
 *
 *          Hard constraints (surfaced as actionable errors, never guessed):
 *            - USER-TO-SERVER TOKENS ONLY: a fine-grained PAT with the
 *              "Agent tasks" repository permission (read+write) plus
 *              Contents / Pull requests, a classic PAT with `repo`, or a
 *              GitHub App *user* access token. Installation tokens — what
 *              `resolveProjectGithubToken` mints — are rejected. The token
 *              is read from `project_settings.github_user_token_ref`
 *              (vault ref, added by a sibling migration) with `GITHUB_TOKEN`
 *              as the self-host fallback.
 *            - Copilot Pro / Pro+ / Max / Business / Enterprise with the
 *              coding-agent policy enabled; otherwise the API answers 403/404.
 *            - No webhook exists — `agent-status-poll` polls. The PR is a
 *              DRAFT opened by `copilot-swe-agent[bot]` on a `copilot/…`
 *              branch; the branch name is only known after the first session
 *              starts (`sessions[].head_ref`), which the poller copies onto
 *              `fix_attempts.branch_name` so `webhooks-github-indexer` can
 *              match the PR by head ref.
 *
 *          Runtime-neutral (no Deno / Supabase imports) so vitest can drive
 *          it with a mocked fetch; token resolution lives in
 *          agent-adapters.ts next to the Cursor key resolution.
 */

import { fetchWithTimeout } from './http.ts'

export const GITHUB_API_BASE = 'https://api.github.com'
export const GITHUB_AGENT_TASKS_API_VERSION = '2026-03-10'
export const GITHUB_AGENT_TASKS_TIMEOUT_MS = 30_000
/** Login of the bot that opens the draft PR — verify on the first live run. */
export const GITHUB_COPILOT_AGENT_LOGIN = 'copilot-swe-agent[bot]'

export type GithubAgentTaskState =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'waiting_for_user'
  | 'timed_out'
  | 'cancelled'

export interface GithubAgentTaskArtifact {
  provider?: string
  type?: string
  data?: Record<string, unknown> | string | null
}

export interface GithubAgentTaskSession {
  id?: string
  state?: string
  model?: string
  head_ref?: string | null
  base_ref?: string | null
  error?: string | null
  prompt?: string
}

export interface GithubAgentTask {
  id: string
  state: GithubAgentTaskState | string
  html_url?: string
  repository?: { id?: number; full_name?: string }
  artifacts?: GithubAgentTaskArtifact[]
  session_count?: number
  sessions?: GithubAgentTaskSession[]
  created_at?: string
  updated_at?: string
  archived_at?: string | null
}

export class GithubAgentTasksError extends Error {
  readonly status: number
  readonly hint: string

  constructor(status: number, detail: string, hint: string) {
    // "GitHub" + the status code in the message lets fix-worker's
    // categorizeFailure land on github_403 / github_404 / github_422.
    super(`GitHub Agent Tasks ${status}: ${detail}${hint ? ` — ${hint}` : ''}`)
    this.name = 'GithubAgentTasksError'
    this.status = status
    this.hint = hint
  }
}

/** Human-actionable explanation per status — the API's own messages are terse. */
export function explainGithubAgentTasksStatus(status: number): string {
  switch (status) {
    case 401:
      return 'Token rejected. The GitHub cloud agent needs a user-to-server token (fine-grained PAT or GitHub App user token); installation tokens are not accepted.'
    case 403:
      return 'Forbidden. Check that the token has the "Agent tasks" (read+write) permission plus Contents/Pull requests on this repo, that the Copilot coding-agent policy is enabled for the org, and that the account is on Copilot Pro/Pro+/Max/Business/Enterprise.'
    case 404:
      return 'Not found. Either the repository is not visible to this token or Agent Tasks are not available for it (policy disabled, plan, or public preview not enabled).'
    case 422:
      return 'Validation failed. Check base_ref exists and the prompt is non-empty.'
    default:
      return status >= 500 ? 'GitHub is having trouble; the poller will retry the status read.' : ''
  }
}

export interface GithubAgentClientOptions {
  token: string
  fetchImpl?: typeof fetch
  baseUrl?: string
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_AGENT_TASKS_API_VERSION,
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi-github-agent-tasks/1.0',
  }
}

async function ghFetch(
  opts: GithubAgentClientOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const url = `${opts.baseUrl ?? GITHUB_API_BASE}${path}`
  const merged: RequestInit = { ...init, headers: { ...headers(opts.token), ...(init.headers ?? {}) } }
  const res = opts.fetchImpl
    ? await opts.fetchImpl(url, merged)
    : await fetchWithTimeout(url, merged, GITHUB_AGENT_TASKS_TIMEOUT_MS)
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { message?: string }
      if (typeof parsed.message === 'string') detail = parsed.message
    } catch {
      /* keep raw excerpt */
    }
    throw new GithubAgentTasksError(res.status, detail || res.statusText, explainGithubAgentTasksStatus(res.status))
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new GithubAgentTasksError(res.status, 'non-JSON response body', '')
  }
}

export interface CreateGithubAgentTaskInput {
  owner: string
  repo: string
  prompt: string
  baseRef?: string
  /** Only for continuing an EXISTING branch/PR — never set on first dispatch. */
  headRef?: string
  model?: string
  customAgent?: string
  createPullRequest?: boolean
}

/** Wire body for POST /agents/repos/{owner}/{repo}/tasks — pinned by tests. */
export function buildCreateTaskBody(input: CreateGithubAgentTaskInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: input.prompt,
    create_pull_request: input.createPullRequest ?? true,
  }
  if (input.baseRef) body.base_ref = input.baseRef
  if (input.headRef) body.head_ref = input.headRef
  if (input.model) body.model = input.model
  if (input.customAgent) body.custom_agent = input.customAgent
  return body
}

export async function createGithubAgentTask(
  opts: GithubAgentClientOptions,
  input: CreateGithubAgentTaskInput,
): Promise<GithubAgentTask> {
  const body = await ghFetch(
    opts,
    `/agents/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/tasks`,
    { method: 'POST', body: JSON.stringify(buildCreateTaskBody(input)) },
  )
  const task = body as Partial<GithubAgentTask> | null
  if (!task || typeof task.id !== 'string' || typeof task.state !== 'string') {
    throw new GithubAgentTasksError(201, 'task response is missing id/state', '')
  }
  return task as GithubAgentTask
}

export async function getGithubAgentTask(
  opts: GithubAgentClientOptions,
  input: { taskId: string; owner?: string; repo?: string },
): Promise<GithubAgentTask> {
  const path = input.owner && input.repo
    ? `/agents/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/tasks/${encodeURIComponent(input.taskId)}`
    : `/agents/tasks/${encodeURIComponent(input.taskId)}`
  const body = await ghFetch(opts, path, { method: 'GET' })
  const task = body as Partial<GithubAgentTask> | null
  if (!task || typeof task.id !== 'string' || typeof task.state !== 'string') {
    throw new GithubAgentTasksError(200, 'task response is missing id/state', '')
  }
  return task as GithubAgentTask
}

export type GithubMappedState = 'working' | 'completed' | 'failed' | 'cancelled'

export function mapGithubTaskState(state: string | null | undefined): GithubMappedState {
  switch ((state ?? '').toLowerCase()) {
    case 'completed':
      return 'completed'
    case 'failed':
    case 'timed_out':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'queued':
    case 'in_progress':
    case 'idle':
    case 'waiting_for_user':
    default:
      return 'working'
  }
}

const PR_URL_RE = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+$/i

/**
 * Best-effort PR URL from `artifacts[]`. The preview docs describe artifacts
 * as `{ provider, type, data }` without pinning a pull-request shape, so we
 * look for any `html_url` / `url` / `pull_request.html_url` that is a GitHub
 * PR link. Returns null when nothing matches — the poller then falls back to
 * the head-ref match in webhooks-github-indexer.
 */
export function extractGithubTaskPrUrl(task: Pick<GithubAgentTask, 'artifacts'> | null | undefined): string | null {
  for (const a of task?.artifacts ?? []) {
    const data = a.data
    if (typeof data === 'string') {
      if (PR_URL_RE.test(data)) return data
      continue
    }
    if (!data || typeof data !== 'object') continue
    const candidates: unknown[] = [
      data.html_url,
      data.url,
      (data.pull_request as { html_url?: unknown } | undefined)?.html_url,
      (data.pull_request as { url?: unknown } | undefined)?.url,
    ]
    for (const c of candidates) {
      if (typeof c === 'string' && PR_URL_RE.test(c)) return c
    }
  }
  return null
}

/** Head branch the agent pushed to (`sessions[].head_ref`), when known. */
export function extractGithubTaskHeadRef(task: Pick<GithubAgentTask, 'sessions'> | null | undefined): string | null {
  for (const s of task?.sessions ?? []) {
    if (typeof s.head_ref === 'string' && s.head_ref.length > 0) return s.head_ref
  }
  return null
}

export function extractGithubTaskError(task: Pick<GithubAgentTask, 'sessions' | 'state'> | null | undefined): string | null {
  for (const s of task?.sessions ?? []) {
    if (typeof s.error === 'string' && s.error.length > 0) return s.error
  }
  return null
}
