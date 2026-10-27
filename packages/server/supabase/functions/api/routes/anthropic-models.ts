/**
 * FILE: packages/server/supabase/functions/api/routes/anthropic-models.ts
 * PURPOSE: The Claude models the app's Anthropic key can use, for the model
 *          pickers in Settings (ADR 0039: a newer model must reach the
 *          console without a release). Reads Anthropic's GET /v1/models with
 *          the key the app's LLM calls resolve to (resolveLlmKey), at most
 *          once an hour per key. The key never leaves the server.
 *
 *   GET /v1/admin/byok/anthropic/models
 *     → { source: 'live', models: [{ id, displayName, createdAt, maxInputTokens, line }] }
 *     → { source: 'none', models: [] }   no Anthropic key resolves for the app
 *     → { source: 'error', models: [], message }   Anthropic did not answer
 *
 * The console falls back to its built-in catalog (apps/admin/src/lib/
 * claudeModels.ts) for 'none' and 'error', so a picker is never empty.
 * Runs in api-ext (api forwards the path; deploy size limit).
 */

import type { Hono } from 'npm:hono@4'
import type { Variables } from '../types.ts'
import { getServiceClient } from '../../_shared/db.ts'
import { jwtAuth } from '../../_shared/auth.ts'
import { resolveOwnedProject } from '../shared.ts'
import { resolveLlmKey } from '../../_shared/byok.ts'

export interface AnthropicModel {
  id: string
  displayName: string | null
  createdAt: string | null
  maxInputTokens: number | null
  /** Anthropic's model line ("opus", "sonnet", "haiku", "fable"…); null when it belongs to none. */
  line: string | null
}

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; models: AnthropicModel[] }>()

/**
 * Shape Anthropic's /v1/models answer into picker rows, newest first. Only
 * `claude-*` ids with a string id are kept; unknown fields are ignored.
 *
 * @internal Exported for tests only.
 */
export function parseAnthropicModels(body: unknown): AnthropicModel[] {
  const rows = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(rows)) return []
  const out: AnthropicModel[] = []
  for (const r of rows as Array<Record<string, unknown>>) {
    const id = typeof r?.id === 'string' ? r.id : null
    if (!id || !/^claude-[a-z0-9.-]+$/.test(id)) continue
    out.push({
      id,
      displayName: typeof r.display_name === 'string' ? r.display_name : null,
      createdAt: typeof r.created_at === 'string' ? r.created_at : null,
      maxInputTokens: typeof r.max_input_tokens === 'number' ? r.max_input_tokens : null,
      line: typeof r.line === 'string' ? r.line : null,
    })
  }
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

/** @internal Exported for tests only. */
export async function listAnthropicModels(
  apiKey: string,
  cacheKey: string,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<AnthropicModel[]> {
  const hit = cache.get(cacheKey)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.models
  const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1000', {
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Anthropic answered ${res.status}`)
  const models = parseAnthropicModels(await res.json())
  cache.set(cacheKey, { at: now, models })
  return models
}

export function registerAnthropicModelRoutes(app: Hono<{ Variables: Variables }>): void {
  app.get('/v1/admin/byok/anthropic/models', jwtAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = getServiceClient()
    const resolved = await resolveOwnedProject(c, db, userId, {
      noProjectResponse: () => c.json({ ok: true, data: { source: 'none', models: [] } }),
    })
    if ('response' in resolved) return resolved.response
    const key = await resolveLlmKey(db, resolved.project.id, 'anthropic', { purpose: 'probe' }).catch(() => null)
    if (!key) return c.json({ ok: true, data: { source: 'none', models: [] } })
    try {
      const models = await listAnthropicModels(key.key, `${key.keyId ?? key.source}:${key.hint}`, Date.now())
      return c.json({ ok: true, data: { source: 'live', models } })
    } catch (err) {
      const message = err instanceof Error ? err.message.slice(0, 160) : 'Anthropic did not answer'
      return c.json({ ok: true, data: { source: 'error', models: [], message } })
    }
  })
}
