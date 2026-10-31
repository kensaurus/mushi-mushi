// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/server/supabase/functions/_shared/cursor-cloud.ts
 * PURPOSE: The ONE Cursor Cloud Agents client for the edge functions.
 *
 *          Before this file there were three divergent request bodies in the
 *          tree (the `plugin-cursor-cloud` npm package on the documented v0
 *          shape, `_shared/plugins.ts deliverCursorAgent` on an undocumented
 *          `cloud:{workspaceId,…}` shape, and the archived `packages/agents`
 *          adapter). Everything now goes through here.
 *
 *          v1 (default) — https://cursor.com/docs/cloud-agent/api/endpoints
 *            POST /v1/agents  { prompt:{text}, repos:[{url,startingRef}],
 *                               autoCreatePR (TOP-LEVEL), agentId:'bc-<uuid>',
 *                               name?, model?:{id} }
 *            → { agent:{ id, status, url, latestRunId }, run:{ id, status, git } }
 *            GET  /v1/agents/{id}                       (Agent + latestRunId)
 *            GET  /v1/agents/{id}/runs/{runId}          (poll)
 *            POST /v1/agents/{id}/runs/{runId}/cancel
 *            GET  /v1/me                                (key probe)
 *            Re-POSTing the same `agentId` answers 409 `agent_id_conflict`,
 *            which is exactly what a retried dispatch wants: we derive the id
 *            deterministically from the fix_dispatch_jobs id, so a lost
 *            response / sweeper re-invoke can never start a second agent.
 *            There is no draft-PR flag — Cursor opens drafts by default; the
 *            prompt carries an explicit "open the pull request as a DRAFT"
 *            instruction (see agent-adapters.ts buildCloudAgentPrompt).
 *            v1 webhooks are still "coming soon"; completion is picked up by
 *            the `agent-status-poll` cron.
 *
 *          v0 (legacy, still served) — https://cursor.com/docs/cloud-agent/api/v0
 *            POST /v0/agents { prompt:{text}, source:{repository,ref},
 *                              target:{autoCreatePr,branchName,skipReviewerRequest},
 *                              model, webhook:{url,secret} }
 *            Only used when `CURSOR_USE_V0_WEBHOOK=1`: v0 is the only API
 *            that can push a `statusChange` webhook back to us today
 *            (`cursor-webhook` edge function). The secret is derived per
 *            project (`buildV0WebhookSecret`) so nothing new has to be stored.
 *
 *          Auth: `Authorization: Bearer <crsr_…>` (Basic with the key as the
 *          username is equivalent; Bearer keeps the header set identical to
 *          the BYOK probe in byok-validation.ts).
 *
 *          Runtime-neutral on purpose (no Deno / Supabase imports) so the
 *          vitest suite can exercise it with a mocked `fetch`.
 */

import { fetchWithTimeout } from './http.ts'

export const CURSOR_API_BASE = 'https://api.cursor.com'
export const CURSOR_DEFAULT_MODEL = 'composer-2.5'
/** Bound a single Cursor call — agent creation is a plain enqueue, never long. */
export const CURSOR_TIMEOUT_MS = 30_000

export type CursorRunStatus = 'CREATING' | 'RUNNING' | 'FINISHED' | 'ERROR' | 'CANCELLED' | 'EXPIRED'

export interface CursorRunGitBranch {
  /** Repository URL without scheme, e.g. `github.com/org/repo`. */
  repoUrl: string
  branch?: string
  prUrl?: string
}

export interface CursorRun {
  id: string
  agentId: string
  status: CursorRunStatus | string
  createdAt?: string
  updatedAt?: string
  durationMs?: number
  /** Final assistant reply (present once FINISHED). */
  result?: string
  git?: { branches?: CursorRunGitBranch[] }
}

export interface CursorAgent {
  id: string
  name?: string
  status?: 'ACTIVE' | 'ARCHIVED' | string
  url?: string
  latestRunId?: string
  createdAt?: string
}

export interface CursorCreateAgentResponse {
  agent: CursorAgent
  run: CursorRun
}

/** Wire shape of a Cursor API error body: `{ error: { code, message, helpUrl?, provider? } }`. */
export interface CursorApiErrorBody {
  error?: { code?: string; message?: string; helpUrl?: string; provider?: string }
}

export class CursorApiError extends Error {
  readonly status: number
  /** Machine-readable Cursor code (`agent_id_conflict`, `unauthorized`, `validation_error`, …). */
  readonly code: string
  readonly helpUrl?: string

  constructor(status: number, code: string, message: string, helpUrl?: string) {
    // The "Cursor API" prefix is load-bearing: fix-worker's categorizeFailure
    // maps it onto fix_attempts.failure_category = cursor_*.
    super(`Cursor API ${status} ${code}: ${message}`)
    this.name = 'CursorApiError'
    this.status = status
    this.code = code
    this.helpUrl = helpUrl
  }
}

export interface CursorClientOptions {
  apiKey: string
  /** Override for tests. Defaults to `fetchWithTimeout`. */
  fetchImpl?: typeof fetch
  baseUrl?: string
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'mushi-mushi-cursor-cloud/1.0',
  }
}

async function cursorFetch(
  opts: CursorClientOptions,
  path: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const url = `${opts.baseUrl ?? CURSOR_API_BASE}${path}`
  const doFetch = opts.fetchImpl
    ? opts.fetchImpl(url, { ...init, headers: { ...authHeaders(opts.apiKey), ...(init.headers ?? {}) } })
    : fetchWithTimeout(
      url,
      { ...init, headers: { ...authHeaders(opts.apiKey), ...(init.headers ?? {}) } },
      CURSOR_TIMEOUT_MS,
    )
  let res: Response
  try {
    res = await doFetch
  } catch (err) {
    // AbortSignal.timeout rejects with a bare "Signal timed out.", which named
    // neither Cursor nor the call and was filed as failure_category unknown
    // (MUSHI-MUSHI-SERVER-28). A create that timed out may still have started
    // an agent on Cursor's side.
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new CursorApiError(0, 'timeout', `no answer in ${CURSOR_TIMEOUT_MS / 1000} s (${init.method ?? 'GET'} ${path})`)
    }
    throw err
  }
  const text = await res.text().catch(() => '')
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text.slice(0, 512) }
    }
  }
  if (!res.ok) {
    const err = (body as CursorApiErrorBody | null)?.error
    throw new CursorApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? (typeof (body as { raw?: string } | null)?.raw === 'string'
        ? (body as { raw: string }).raw
        : res.statusText || 'request failed'),
      err?.helpUrl,
    )
  }
  return { status: res.status, body }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic agent ids
// ─────────────────────────────────────────────────────────────────────────────

const CURSOR_AGENT_ID_NAMESPACE = 'mushi-mushi:cursor-cloud:agent-id:v1'

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

/**
 * `bc-<uuid>` derived from a stable seed (the fix_dispatch_jobs id). Same seed
 * ⇒ same id ⇒ a retried POST /v1/agents answers 409 `agent_id_conflict`
 * instead of starting a second agent. Layout follows RFC 9562 name-based
 * UUIDs (version nibble 5, RFC 4122 variant) over SHA-256 — SHA-1/MD5 are
 * not worth pulling into an edge bundle for an idempotency key.
 */
export async function deterministicCursorAgentId(seed: string): Promise<string> {
  const data = new TextEncoder().encode(`${CURSOR_AGENT_ID_NAMESPACE}\u0000${seed}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  const b = digest.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const hex = bytesToHex(b)
  return `bc-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const CURSOR_AGENT_ID_RE = /^bc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─────────────────────────────────────────────────────────────────────────────
// v1 endpoints
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateCursorAgentV1Input {
  prompt: string
  /** `https://github.com/org/repo` — Cursor accepts the scheme-bearing form. */
  repoUrl: string
  /** Branch/ref to start from (the repo default branch). Ignored by Cursor when `prUrl` is set. */
  startingRef?: string
  /**
   * An existing pull request to work on (`repos[].prUrl`). Cursor checks out
   * its head branch; `startingRef` is then ignored, so it is not sent.
   * https://cursor.com/docs/cloud-agent/api/endpoints (verified 2026-10-21)
   */
  prUrl?: string
  /**
   * Top-level `workOnCurrentBranch`: push to the checked-out branch (the PR's
   * head when `prUrl` is set) instead of a new branch. Review follow-ups
   * (ADR 0032) set it with `autoCreatePR: false`.
   */
  workOnCurrentBranch?: boolean
  /** `bc-<uuid>` idempotency key; see deterministicCursorAgentId. */
  agentId?: string
  /** 1–100 chars; shown in the Cursor dashboard. */
  name?: string
  model?: string
  autoCreatePR?: boolean
  skipReviewerRequest?: boolean
  envVars?: Record<string, string>
}

/**
 * A saved Cursor model setting: a model id, optionally followed by params in
 * query form, e.g. `grok-4.7?reasoning_effort=xhigh&context=500k`. GET
 * /v1/models lists each model's params. Returns null for anything that is not
 * a plain id with plain params, so a bad value never reaches Cursor.
 */
export function parseCursorModelSpec(raw: string): { id: string; params: Array<{ id: string; value: string }> } | null {
  const text = raw.trim()
  const q = text.indexOf('?')
  const id = (q < 0 ? text : text.slice(0, q)).trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id)) return null
  const params: Array<{ id: string; value: string }> = []
  if (q >= 0) {
    for (const part of text.slice(q + 1).split('&')) {
      if (!part) continue
      const eq = part.indexOf('=')
      if (eq <= 0) return null
      const key = part.slice(0, eq).trim()
      const value = part.slice(eq + 1).trim()
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || !/^[A-Za-z0-9_.-]{1,40}$/.test(value)) return null
      if (params.some((p) => p.id === key)) return null
      params.push({ id: key, value })
    }
  }
  return { id, params }
}

/**
 * The Cursor model one fix dispatch runs on: the dispatch's own
 * `model_override` (CLI `--model`, spend-down) when set, else the project's
 * `cursor_default_model`, else the account default (undefined). Other agents
 * get undefined.
 */
export function cursorModelForDispatch(
  agent: string,
  dispatchMeta: Record<string, unknown> | null | undefined,
  projectDefault: unknown,
): string | undefined {
  if (agent !== 'cursor_cloud') return undefined
  const override = dispatchMeta?.model_override
  if (typeof override === 'string' && override.trim() !== '') return override.trim()
  return typeof projectDefault === 'string' && projectDefault.trim() !== '' ? projectDefault : undefined
}

/** Wire body for POST /v1/agents — exported so tests can pin the exact shape. */
export function buildCreateAgentV1Body(input: CreateCursorAgentV1Input): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: { text: input.prompt },
    repos: [
      {
        url: input.repoUrl,
        ...(input.prUrl ? { prUrl: input.prUrl } : input.startingRef ? { startingRef: input.startingRef } : {}),
      },
    ],
    // TOP-LEVEL in v1 (v0 nested it under `target.autoCreatePr`).
    autoCreatePR: input.autoCreatePR ?? true,
  }
  if (input.workOnCurrentBranch !== undefined) body.workOnCurrentBranch = input.workOnCurrentBranch
  if (input.agentId) body.agentId = input.agentId
  if (input.name) body.name = input.name.slice(0, 100)
  if (input.model) {
    const spec = parseCursorModelSpec(input.model)
    if (spec) body.model = spec.params.length > 0 ? { id: spec.id, params: spec.params } : { id: spec.id }
  }
  if (input.skipReviewerRequest !== undefined) body.skipReviewerRequest = input.skipReviewerRequest
  if (input.envVars && Object.keys(input.envVars).length > 0) body.envVars = input.envVars
  return body
}

export async function createCursorAgentV1(
  opts: CursorClientOptions,
  input: CreateCursorAgentV1Input,
): Promise<CursorCreateAgentResponse & { httpStatus: number }> {
  const { status, body } = await cursorFetch(opts, '/v1/agents', {
    method: 'POST',
    body: JSON.stringify(buildCreateAgentV1Body(input)),
  })
  const parsed = body as Partial<CursorCreateAgentResponse> | null
  if (!parsed?.agent?.id || !parsed.run?.id) {
    throw new CursorApiError(status, 'malformed_response', 'POST /v1/agents returned no agent/run id')
  }
  // The real 2xx (Cursor answers 201 Created), for plugin_dispatch_log.http_status.
  return { agent: parsed.agent, run: parsed.run, httpStatus: status }
}

/** One entry of GET /v1/models: an id for model.id plus the params it accepts. */
export interface CursorModelInfo {
  id: string
  displayName?: string
  description?: string
  aliases?: string[]
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
  variants?: Array<{ params: Array<{ id: string; value: string }>; displayName?: string; description?: string; isDefault?: boolean }>
}

/** The models this Cursor key can pass as model.id, with their params and variants. */
export async function listCursorModelsV1(opts: CursorClientOptions): Promise<CursorModelInfo[]> {
  const { body } = await cursorFetch(opts, '/v1/models', { method: 'GET' })
  const items = (body as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) throw new CursorApiError(200, 'malformed_response', 'GET /v1/models returned no items')
  return items.filter((m): m is CursorModelInfo => typeof (m as CursorModelInfo)?.id === 'string')
}

export async function getCursorAgent(opts: CursorClientOptions, agentId: string): Promise<CursorAgent> {
  const { body } = await cursorFetch(opts, `/v1/agents/${encodeURIComponent(agentId)}`, { method: 'GET' })
  const parsed = body as Partial<CursorAgent> | null
  if (!parsed?.id) throw new CursorApiError(200, 'malformed_response', 'GET /v1/agents/{id} returned no id')
  return parsed as CursorAgent
}

export async function getCursorRun(
  opts: CursorClientOptions,
  agentId: string,
  runId: string,
): Promise<CursorRun> {
  const { body } = await cursorFetch(
    opts,
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}`,
    { method: 'GET' },
  )
  const parsed = body as Partial<CursorRun> | null
  if (!parsed?.id || typeof parsed.status !== 'string') {
    throw new CursorApiError(200, 'malformed_response', 'GET /v1/agents/{id}/runs/{runId} returned no run')
  }
  return parsed as CursorRun
}

export async function cancelCursorRun(
  opts: CursorClientOptions,
  agentId: string,
  runId: string,
): Promise<{ id: string }> {
  const { body } = await cursorFetch(
    opts,
    `/v1/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' },
  )
  return { id: String((body as { id?: unknown } | null)?.id ?? runId) }
}

/** GET /v1/me — key probe shared by byok-validation.ts and integration-probes.ts. */
export async function getCursorMe(
  opts: CursorClientOptions,
): Promise<{ apiKeyName?: string; userEmail?: string; userId?: number }> {
  const { body } = await cursorFetch(opts, '/v1/me', { method: 'GET' })
  return (body ?? {}) as { apiKeyName?: string; userEmail?: string; userId?: number }
}

export type CursorMappedStatus = 'working' | 'completed' | 'failed' | 'cancelled'

export function mapCursorRunStatus(status: string | null | undefined): CursorMappedStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'FINISHED':
      return 'completed'
    case 'ERROR':
    case 'EXPIRED':
      return 'failed'
    case 'CANCELLED':
      return 'cancelled'
    case 'CREATING':
    case 'RUNNING':
    default:
      return 'working'
  }
}

/** First PR URL across `run.git.branches[]` (a run may touch several repos). */
export function extractCursorPrUrl(run: Pick<CursorRun, 'git'> | null | undefined): string | null {
  const branches = run?.git?.branches ?? []
  for (const b of branches) {
    if (typeof b.prUrl === 'string' && b.prUrl.startsWith('http')) return b.prUrl
  }
  return null
}

export function extractCursorBranch(run: Pick<CursorRun, 'git'> | null | undefined): string | null {
  const branches = run?.git?.branches ?? []
  for (const b of branches) {
    if (typeof b.branch === 'string' && b.branch.length > 0) return b.branch
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// v0 webhook path (opt-in via CURSOR_USE_V0_WEBHOOK=1)
// ─────────────────────────────────────────────────────────────────────────────

/** v0 requires a ≥ 32-char secret; 64 hex chars of HMAC-SHA256 clears it. */
export const CURSOR_V0_WEBHOOK_MIN_SECRET_LEN = 32

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return bytesToHex(new Uint8Array(sig))
}

/**
 * Per-project webhook secret handed to Cursor's v0 `webhook.secret`:
 * hex HMAC-SHA256(MUSHI_INTERNAL_CALLER_SECRET, projectId). Derived, never
 * stored — `cursor-webhook` recomputes it from `?project=` to verify
 * `X-Webhook-Signature`. Pass `secretSource` explicitly in tests; at runtime
 * it comes from MUSHI_INTERNAL_CALLER_SECRET (SUPABASE_SERVICE_ROLE_KEY as the
 * last resort, mirroring requireServiceRoleAuth).
 */
export async function buildV0WebhookSecret(projectId: string, secretSource?: string): Promise<string> {
  const source = secretSource ?? readRuntimeSecretSource()
  if (!source) throw new Error('buildV0WebhookSecret: MUSHI_INTERNAL_CALLER_SECRET is not configured')
  return hmacSha256Hex(source, `cursor-v0-webhook:${projectId}`)
}

function readRuntimeSecretSource(): string | undefined {
  if (typeof Deno === 'undefined') return undefined
  return Deno.env.get('MUSHI_INTERNAL_CALLER_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined
}

/** `sha256=<hex>` header check, constant-time on the hex digest. */
export async function verifyV0WebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false
  const provided = signatureHeader.trim().toLowerCase()
  const hex = provided.startsWith('sha256=') ? provided.slice('sha256='.length) : provided
  const expected = await hmacSha256Hex(secret, rawBody)
  if (hex.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hex.charCodeAt(i)
  return diff === 0
}

export function preferV0WebhookPath(): boolean {
  if (typeof Deno === 'undefined') return false
  return Deno.env.get('CURSOR_USE_V0_WEBHOOK') === '1'
}

export function cursorWebhookCallbackUrl(projectId: string, supabaseUrl?: string): string {
  const base = supabaseUrl ?? (typeof Deno !== 'undefined' ? Deno.env.get('SUPABASE_URL') : undefined) ?? ''
  if (!base) throw new Error('cursorWebhookCallbackUrl: SUPABASE_URL is not configured')
  return `${base.replace(/\/$/, '')}/functions/v1/cursor-webhook?project=${encodeURIComponent(projectId)}`
}

export interface CreateCursorAgentV0Input {
  prompt: string
  repoUrl: string
  ref?: string
  branchName?: string
  model?: string
  autoCreatePr?: boolean
  webhook: { url: string; secret: string }
}

export function buildCreateAgentV0Body(input: CreateCursorAgentV0Input): Record<string, unknown> {
  if (input.webhook.secret.length < CURSOR_V0_WEBHOOK_MIN_SECRET_LEN) {
    throw new Error(`Cursor v0 webhook.secret must be ≥ ${CURSOR_V0_WEBHOOK_MIN_SECRET_LEN} chars`)
  }
  return {
    prompt: { text: input.prompt },
    source: { repository: input.repoUrl, ref: input.ref ?? 'main' },
    target: {
      autoCreatePr: input.autoCreatePr ?? true,
      ...(input.branchName ? { branchName: input.branchName } : {}),
      skipReviewerRequest: true,
    },
    model: input.model ?? CURSOR_DEFAULT_MODEL,
    webhook: { url: input.webhook.url, secret: input.webhook.secret },
  }
}

export interface CursorV0AgentResponse {
  id: string
  status?: string
  name?: string
  target?: { url?: string; branchName?: string; prUrl?: string }
}

export async function createCursorAgentV0(
  opts: CursorClientOptions,
  input: CreateCursorAgentV0Input,
): Promise<CursorV0AgentResponse> {
  const { body } = await cursorFetch(opts, '/v0/agents', {
    method: 'POST',
    body: JSON.stringify(buildCreateAgentV0Body(input)),
  })
  const parsed = body as Partial<CursorV0AgentResponse> & { agentId?: string } | null
  const id = parsed?.id ?? parsed?.agentId
  if (!id) throw new CursorApiError(200, 'malformed_response', 'POST /v0/agents returned no id')
  return { ...(parsed as CursorV0AgentResponse), id }
}

/** v0 `statusChange` webhook payload (fired on FINISHED / ERROR). */
export interface CursorV0WebhookPayload {
  event?: string
  timestamp?: string
  id: string
  status: 'FINISHED' | 'ERROR' | string
  source?: { repository?: string; ref?: string }
  target?: { url?: string; branchName?: string; prUrl?: string }
  summary?: string
}
