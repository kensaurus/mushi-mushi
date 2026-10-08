// SPDX-License-Identifier: MIT
/**
 * The models an agent can run, read live wherever the agent can say:
 *
 *   cursor        `agent models` (the signed-in Cursor account's list)
 *   cursor-cloud  Cursor API GET /v1/models, with each model's params
 *                 (effort, context) so the UI can offer them
 *   claude-code   Anthropic GET /v1/models when ANTHROPIC_API_KEY is set,
 *                 else the aliases Claude Code accepts (opus, sonnet, haiku)
 *   codex         OpenAI GET /v1/models when OPENAI_API_KEY is set
 *
 * Nothing here is a fixed model list: a typed id is always accepted, and the
 * agent itself is the judge of whether it exists.
 */

import { run } from './proc.js'

export interface ModelParam {
  id: string
  label: string
  values: Array<{ value: string; label: string }>
}

export interface ModelOption {
  id: string
  label: string
  description?: string
  /** Settings the model takes, sent as `id?param=value&…`. */
  params?: ModelParam[]
  isDefault?: boolean
}

export interface ModelList {
  agent: string
  /** live = read from the provider now; aliases = what the CLI accepts; none = type an id. */
  source: 'live' | 'aliases' | 'none'
  models: ModelOption[]
  /** Why the list is short or missing (not signed in, no key). */
  note?: string
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/

/**
 * `agent models` prints one model per line, usually `id - Display name`, with
 * a heading and sometimes a marker on the current one. Keep lines that start
 * with an id; drop prose.
 */
export function parseCursorCliModels(text: string): ModelOption[] {
  const out: ModelOption[] = []
  const seen = new Set<string>()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/^[\s*•>✓●-]+/, '').trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s*(?:[-–—:]\s+|\s{2,}|\(|$)(.*)$/)
    if (!m || !ID_RE.test(m[1]) || !/[\d.-]/.test(m[1])) continue
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    const rest = m[2].replace(/\)$/, '').trim()
    const isDefault = /\b(current|default)\b/i.test(rest)
    const label = rest.replace(/\s*[([]?\b(current|default)\b[)\]]?/gi, '').trim() || id
    out.push({ id, label, ...(isDefault ? { isDefault } : {}) })
  }
  return out
}

interface CursorApiModel {
  id: string
  displayName?: string
  description?: string
  parameters?: Array<{ id: string; displayName?: string; values: Array<{ value: string; displayName?: string }> }>
}

/** Cursor GET /v1/models items → options with their params. */
export function fromCursorApi(items: CursorApiModel[]): ModelOption[] {
  return items
    .filter((m) => typeof m.id === 'string' && ID_RE.test(m.id))
    .map((m) => ({
      id: m.id,
      label: m.displayName || m.id,
      ...(m.description ? { description: m.description } : {}),
      ...(m.parameters?.length
        ? {
            params: m.parameters.map((p) => ({
              id: p.id,
              label: p.displayName || p.id,
              values: p.values.map((v) => ({ value: v.value, label: v.displayName || v.value })),
            })),
          }
        : {}),
    }))
}

export interface ListModelsDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  /** Runs `agent models`; replaceable in tests. */
  cursorCli?: () => Promise<{ exitCode: number | null; stdout: string; tail: string }>
}

export async function listModels(agent: string, deps: ListModelsDeps = {}): Promise<ModelList> {
  const env = deps.env ?? process.env
  const doFetch = deps.fetch ?? fetch
  const getJson = async (url: string, headers: Record<string, string>) => {
    const res = await doFetch(url, { headers, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
    return res.json() as Promise<unknown>
  }
  try {
    if (agent === 'cursor') {
      const res = await (deps.cursorCli ?? (() => run('agent', ['models'], { cwd: process.cwd(), shell: true, timeoutMs: 60_000 })))()
      const models = parseCursorCliModels(res.stdout || res.tail)
      if (res.exitCode !== 0 || models.length === 0) {
        const signedOut = /log ?in|not (logged|authenticated)|unauthori/i.test(res.tail)
        return {
          agent,
          source: 'none',
          models: [],
          note: signedOut ? 'The Cursor CLI is not signed in. Run `agent login`.' : `\`agent models\` gave no list: ${res.tail.trim().slice(-200) || 'is the Cursor CLI installed?'}`,
        }
      }
      return { agent, source: 'live', models }
    }
    if (agent === 'cursor-cloud') {
      const key = env.CURSOR_API_KEY
      if (!key) return { agent, source: 'none', models: [], note: 'Set CURSOR_API_KEY to list Cursor Cloud models.' }
      const body = (await getJson('https://api.cursor.com/v1/models', { Authorization: `Bearer ${key}` })) as { items?: CursorApiModel[] }
      return { agent, source: 'live', models: fromCursorApi(body.items ?? []) }
    }
    if (agent === 'claude-code') {
      const key = env.ANTHROPIC_API_KEY
      if (key) {
        const body = (await getJson('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' })) as {
          data?: Array<{ id: string; display_name?: string }>
        }
        return { agent, source: 'live', models: (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id })) }
      }
      return {
        agent,
        source: 'aliases',
        models: [
          { id: 'opus', label: 'Opus (latest)' },
          { id: 'sonnet', label: 'Sonnet (latest)' },
          { id: 'haiku', label: 'Haiku (latest)' },
        ],
        note: 'Claude Code aliases; any full model id also works.',
      }
    }
    if (agent === 'codex') {
      const key = env.OPENAI_API_KEY ?? env.CODEX_API_KEY
      if (!key) return { agent, source: 'none', models: [], note: 'Type a model id, or leave empty for Codex’s default.' }
      const body = (await getJson('https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` })) as { data?: Array<{ id: string }> }
      return { agent, source: 'live', models: (body.data ?? []).map((m) => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id)) }
    }
  } catch (err) {
    return { agent, source: 'none', models: [], note: `Could not list models: ${(err as Error).message.slice(0, 200)}` }
  }
  return { agent, source: 'none', models: [], note: 'Type a model id.' }
}
