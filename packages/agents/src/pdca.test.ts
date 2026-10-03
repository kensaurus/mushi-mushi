/**
 * PdcaRunner against the real AI SDK Anthropic provider, with HTTP stubbed.
 *
 * The Sonnet 5.5 migration failed once already on this exact shape: the
 * provider does not know `claude-sonnet-5-5`, so without an explicit
 * structured-output mode `generateObject` sends a forced `tool_choice`, which
 * Sonnet 5.5 rejects with a 400 (and the blanket fallback then quietly ran the
 * whole loop on OpenAI). These tests read the request bodies the provider
 * actually builds, and fail on any call to OpenAI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

interface Inserted { table: string; row: Record<string, unknown> }

const dbState = vi.hoisted(() => ({ inserts: [] as Array<{ table: string; row: Record<string, unknown> }> }))

vi.mock('@supabase/supabase-js', () => {
  const builder = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      update: () => q,
      single: async () => ({ data: table === 'agent_personas' ? { prompt: 'You are a strict UX reviewer.' } : null, error: null }),
      insert: async (row: Record<string, unknown>) => {
        dbState.inserts.push({ table, row })
        return { data: null, error: null }
      },
      then: (ok: (v: { data: null; error: null }) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
    }
    return q
  }
  return { createClient: () => ({ from: builder }) }
})

import { PdcaRunner, type PdcaConfig } from './pdca.js'
import { PDCA_MAX_OUTPUT_TOKENS, pdcaCallCostUsd } from './pdca-models.js'

type JsonObject = Record<string, unknown>

const PAGE_URL = 'https://app.example.test/'
const CRITIQUE = {
  overall_score: 0.9,
  dimensions: [{ name: 'clarity', score: 0.8 }, { name: 'hierarchy', score: 1 }],
  critique_text: 'Tighten the heading.',
  top_issues: ['heading'],
}

function anthropicMessage(text: string, usage: { input_tokens: number; output_tokens: number }) {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function stubFetch() {
  const anthropicBodies: JsonObject[] = []
  const otherHosts: string[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === PAGE_URL) return new Response('<h1>Checkout</h1>', { status: 200 })
    if (url.startsWith('https://api.anthropic.com/')) {
      const body = JSON.parse(String(init?.body)) as JsonObject
      anthropicBodies.push(body)
      return body.output_config
        ? anthropicMessage(JSON.stringify(CRITIQUE), { input_tokens: 2_000, output_tokens: 400 })
        : anthropicMessage('<h1>Checkout</h1><p>Clearer</p>', { input_tokens: 1_000, output_tokens: 300 })
    }
    otherHosts.push(url)
    return new Response(JSON.stringify({ error: { message: 'unexpected host in test' } }), { status: 500 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, anthropicBodies, otherHosts }
}

function config(overrides: Partial<PdcaConfig> = {}): PdcaConfig {
  return {
    supabaseUrl: 'https://db.example.test',
    supabaseServiceKey: 'service-key',
    projectId: 'p1',
    targetUrl: PAGE_URL,
    goal: 'Make checkout clearer',
    iterations: 1,
    targetScore: 0.85,
    anthropicApiKey: 'sk-ant-test',
    openaiApiKey: 'sk-openai-test',
    ...overrides,
  }
}

/** Every key used anywhere in a JSON Schema tree. */
function schemaKeys(node: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(node)) node.forEach((n) => schemaKeys(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      out.add(k)
      if (k !== 'properties') schemaKeys(v, out)
      else Object.values(v as JsonObject).forEach((p) => schemaKeys(p, out))
    }
  }
  return out
}

beforeEach(() => {
  dbState.inserts.length = 0
})

describe('PdcaRunner on Claude Sonnet 5.5', () => {
  it('defaults producer and critic to claude-sonnet-5-5 and never forces a tool call', async () => {
    const { fetchImpl, anthropicBodies, otherHosts } = stubFetch()
    const result = await new PdcaRunner(config({ fetch: fetchImpl })).run()

    expect(otherHosts).toEqual([])
    expect(result).toMatchObject({ status: 'succeeded', exitReason: 'target_reached', finalScore: 0.9 })
    expect(anthropicBodies).toHaveLength(2)
    const [producer, critic] = anthropicBodies

    expect(producer.model).toBe('claude-sonnet-5-5')
    expect(producer.max_tokens).toBe(PDCA_MAX_OUTPUT_TOKENS)
    expect(producer).not.toHaveProperty('temperature')

    expect(critic.model).toBe('claude-sonnet-5-5')
    expect(critic.max_tokens).toBe(PDCA_MAX_OUTPUT_TOKENS)
    expect(critic).not.toHaveProperty('tools')
    expect(critic).not.toHaveProperty('tool_choice')
    expect(critic).not.toHaveProperty('temperature')
    const format = (critic.output_config as JsonObject).format as JsonObject
    expect(format.type).toBe('json_schema')
    // Bounds the API rejects travel as prose; the Zod schema still enforces them.
    const keys = schemaKeys(format.schema)
    for (const banned of ['minimum', 'maximum', 'maxItems', 'maxLength']) expect(keys.has(banned)).toBe(false)
  })

  it('keeps the per-dimension scores and prices each call from the pricing table', async () => {
    const { fetchImpl } = stubFetch()
    const result = await new PdcaRunner(config({ fetch: fetchImpl })).run()

    const producerCost = pdcaCallCostUsd('claude-sonnet-5-5', { inputTokens: 1_000, outputTokens: 300 })
    const criticCost = pdcaCallCostUsd('claude-sonnet-5-5', { inputTokens: 2_000, outputTokens: 400 })
    expect(result.iterations[0].scoreBreakdown).toEqual({ clarity: 0.8, hierarchy: 1 })
    expect(result.iterations[0].costUsd).toBeCloseTo(producerCost + criticCost, 10)

    const costRows: Inserted[] = dbState.inserts.filter((i) => i.table === 'llm_cost_usd')
    expect(costRows.map((r) => r.row)).toEqual([
      { project_id: 'p1', operation: 'pdca-producer', model: 'claude-sonnet-5-5', input_tokens: 1_000, output_tokens: 300, cost_usd: producerCost },
      { project_id: 'p1', operation: 'pdca-critic', model: 'claude-sonnet-5-5', input_tokens: 2_000, output_tokens: 400, cost_usd: criticCost },
    ])
  })

  it('calls the model the caller picked', async () => {
    const { fetchImpl, anthropicBodies } = stubFetch()
    await new PdcaRunner(config({ fetch: fetchImpl, primaryModel: 'claude-haiku-4-5', judgeModel: 'claude-opus-5-5' })).run()
    expect(anthropicBodies.map((b) => b.model)).toEqual(['claude-haiku-4-5', 'claude-opus-5-5'])
  })

  it('refuses a model it cannot call or price before anything is spent', () => {
    expect(() => new PdcaRunner(config({ primaryModel: 'claude-sonnet-4-6' }))).toThrow(/primaryModel "claude-sonnet-4-6"/)
    expect(() => new PdcaRunner(config({ judgeModel: 'gpt-5.4' }))).toThrow(/judgeModel "gpt-5.4"/)
    expect(() => new PdcaRunner(config({ judgeModel: 'claude-opus-4-7' }))).toThrow(/claude-sonnet-5-5/)
  })
})
