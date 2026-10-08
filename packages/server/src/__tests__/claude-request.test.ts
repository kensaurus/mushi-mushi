/**
 * Sonnet 5.5 migration (2026-10-02): request shape per model, stored-model
 * mapping, the structured-output schema subset, and refusal handling in the
 * failover layer. The SDK-level behaviour (what actually goes over the wire,
 * streaming, error mapping) is covered by the Deno test
 * `supabase/functions/api/__tests__/claude-messages.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest'

// llm-failover.ts reads its retry tuning from Deno.env at module load.
vi.hoisted(() => {
  ;(globalThis as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } }
})

// Every `npm:` specifier resolves to one permissive stub module in vitest;
// llm-failover needs a real `NoObjectGeneratedError.isInstance` from it.
vi.mock('npm:ai@4', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  NoObjectGeneratedError: { isInstance: (e: unknown) => (e as { name?: string })?.name === 'AI_NoObjectGeneratedError' },
}))

vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  resolveLlmKeys: async (_db: unknown, _projectId: string, provider: string) => [
    { key: `${provider}-key`, source: 'byok', hint: 'abcd', keyId: `${provider}-1` },
  ],
  markKeyStatus: vi.fn(async () => {}),
  markKeyUsed: vi.fn(async () => {}),
  // Budget enforcement is covered in llm-budget-enforcement.test.ts.
  enforceLlmBudget: async () => {},
}))

vi.mock('../../supabase/functions/_shared/hosted-llm-billing.ts', () => ({
  hostedLlmPreflight: async () => ({ allowed: true }),
  providerFromModel: () => 'anthropic',
  scheduleHostedLlmCharge: () => {},
  WalletDeniedError: class WalletDeniedError extends Error {},
}))

import {
  buildClaudeRequest,
  claudeModelTraits,
  ClaudeRefusalError,
  isClaudeRefusal,
  resolveClaudeModel,
  SERVER_SIDE_FALLBACK_BETA,
  toClaudeMessages,
  toClaudeOutputSchema,
  toLegacyUsage,
} from '../../supabase/functions/_shared/claude-request.ts'
import { classifyLlmError, withAnthropicOrOpenAi } from '../../supabase/functions/_shared/llm-failover.ts'
import {
  ASSIST_MODEL,
  FIX_MODEL,
  INTELLIGENCE_MODEL,
  JUDGE_MODEL,
  STAGE1_MODEL,
  STAGE2_MODEL,
} from '../../supabase/functions/_shared/models.ts'
import { estimateCallCostUsd } from '../../supabase/functions/_shared/pricing.ts'

describe('model registry', () => {
  it('routes diagnosis, fixes and the judge to Sonnet 5.5', () => {
    for (const model of [STAGE2_MODEL, FIX_MODEL, JUDGE_MODEL]) {
      expect(model).toBe('claude-sonnet-5-5')
    }
  })

  it('runs the assistants and the digest on Haiku 5.5 (owner, 2026-10-08: cost)', () => {
    for (const model of [ASSIST_MODEL, INTELLIGENCE_MODEL]) {
      expect(model).toBe('claude-haiku-5-5')
    }
    expect(claudeModelTraits('claude-haiku-5-5').acceptsSampling).toBe(false)
  })

  it('keeps stage 1 on the Haiku 4.5 alias (no dated suffix)', () => {
    expect(STAGE1_MODEL).toBe('claude-haiku-4-5')
  })

  it('prices Sonnet 5.5 and its server-side fallback model at $2 / $10 per MTok', () => {
    expect(estimateCallCostUsd('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBeCloseTo(12)
    expect(estimateCallCostUsd('claude-sonnet-5', 1_000_000, 1_000_000)).toBeCloseTo(12)
    expect(estimateCallCostUsd('anthropic/claude-sonnet-5-5', 1_000, 0)).toBeCloseTo(0.002)
  })
})

describe('claudeModelTraits', () => {
  it('Sonnet 5.5: no sampling knobs, every effort level, server-side fallback', () => {
    expect(claudeModelTraits('claude-sonnet-5-5')).toEqual({
      acceptsSampling: false,
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      serverSideFallback: true,
    })
  })

  it('Opus 4.7 and Sonnet 5: no sampling knobs, no "default" fallback form', () => {
    for (const model of ['claude-opus-4-7', 'claude-sonnet-5']) {
      expect(claudeModelTraits(model)).toMatchObject({ acceptsSampling: false, serverSideFallback: false })
    }
  })

  it('Sonnet 4.6 and Haiku 4.5 keep the pre-migration request: sampling, no effort', () => {
    for (const model of ['claude-sonnet-4-6', 'claude-haiku-4-5', 'anthropic/claude-haiku-4-5-20251001']) {
      expect(claudeModelTraits(model)).toEqual({ acceptsSampling: true, effortLevels: [], serverSideFallback: false })
    }
  })
})

describe('buildClaudeRequest', () => {
  const schema = toClaudeOutputSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })

  it('Sonnet 5.5: structured output + effort + fallback, never sampling / tool_choice / thinking', () => {
    const { body, betas } = buildClaudeRequest({
      model: 'claude-sonnet-5-5',
      maxTokens: 16_000,
      temperature: 0,
      effort: 'medium',
      outputSchema: schema,
      messages: [
        { role: 'system', content: 'sys', experimental_providerMetadata: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
        { role: 'user', content: 'hi' },
      ],
    })
    for (const banned of ['temperature', 'top_p', 'top_k', 'tool_choice', 'tools', 'thinking']) {
      expect(body).not.toHaveProperty(banned)
    }
    expect(body.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema } })
    expect(body.fallbacks).toBe('default')
    expect(betas).toEqual([SERVER_SIDE_FALLBACK_BETA])
    expect(betas[0]).toBe('server-side-fallback-2026-07-01')
    expect(body.system).toEqual([{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }])
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('a Sonnet 4.6 override sends temperature 0 and no effort, as AI SDK v4 did', () => {
    const { body, betas } = buildClaudeRequest({
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      effort: 'medium',
      outputSchema: schema,
      prompt: 'hi',
    })
    expect(body.temperature).toBe(0)
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema } })
    expect(body).not.toHaveProperty('fallbacks')
    expect(betas).toEqual([])
  })

  it('drops an effort level the model does not accept', () => {
    const { body } = buildClaudeRequest({ model: 'claude-haiku-4-5', maxTokens: 256, effort: 'low', prompt: 'hi' })
    expect(body).not.toHaveProperty('output_config')
  })
})

describe('toClaudeMessages', () => {
  it('lifts system messages out of the turn list and maps images to URL sources', () => {
    const { system, messages } = toClaudeMessages({
      messages: [
        { role: 'system', content: 'inspect' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'see image' },
            { type: 'image', image: 'https://cdn.example.com/s.png' },
          ],
        },
      ],
    })
    expect(system).toEqual([{ type: 'text', text: 'inspect' }])
    expect(messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'see image' },
          { type: 'image', source: { type: 'url', url: 'https://cdn.example.com/s.png' } },
        ],
      },
    ])
  })

  it('rejects a request with no user turn', () => {
    expect(() => toClaudeMessages({ system: 'only system' })).toThrow(/user message/)
  })
})

describe('resolveClaudeModel', () => {
  const DEFAULT = 'claude-sonnet-5-5'
  it.each([
    [null, DEFAULT],
    ['', DEFAULT],
    ['claude-3-5-sonnet-20241022', DEFAULT],
    ['claude-3-7-sonnet-latest', DEFAULT],
    ['claude-sonnet-4-20250514', DEFAULT],
    ['claude-sonnet-4-5-20250929', DEFAULT],
    ['claude-opus-4-1', DEFAULT],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5'],
    ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['claude-opus-4-7', 'claude-opus-4-7'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5'],
    ['gpt-5.4', 'gpt-5.4'],
  ])('%s → %s', (stored, expected) => {
    expect(resolveClaudeModel(stored, DEFAULT)).toBe(expected)
  })
})

describe('toClaudeOutputSchema', () => {
  it('keeps enum/const, forces additionalProperties:false, moves unsupported constraints to prose', () => {
    const out = toClaudeOutputSchema({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: true,
      properties: {
        severity: { type: 'string', enum: ['low', 'high'] },
        kind: { const: 'report' },
        summary: { type: 'string', maxLength: 200, description: 'One line' },
        score: { type: 'number', minimum: 0, maximum: 1 },
        steps: { type: 'array', items: { type: 'string' }, minItems: 2 },
        tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
        at: { type: 'string', format: 'date-time' },
        nested: { type: 'object', properties: { x: { type: ['string', 'null'] } } },
      },
      required: ['severity'],
    }) as Record<string, any>

    expect(out).not.toHaveProperty('$schema')
    expect(out.additionalProperties).toBe(false)
    expect(out.required).toEqual(['severity'])
    expect(out.properties.severity).toEqual({ type: 'string', enum: ['low', 'high'] })
    expect(out.properties.kind).toEqual({ const: 'report' })
    expect(out.properties.summary).toEqual({ type: 'string', description: 'One line\n\n{maxLength: 200}' })
    expect(out.properties.score.description).toBe('{minimum: 0, maximum: 1}')
    expect(out.properties.steps).toEqual({ type: 'array', items: { type: 'string' }, description: '{minItems: 2}' })
    expect(out.properties.tags.minItems).toBe(1)
    expect(out.properties.at.format).toBe('date-time')
    expect(out.properties.nested.additionalProperties).toBe(false)
    expect(out.properties.nested.properties.x).toEqual({ type: ['string', 'null'] })
  })

  it('does not mutate its input', () => {
    const input = { type: 'object', properties: { a: { type: 'string', maxLength: 3 } } }
    toClaudeOutputSchema(input)
    expect(input.properties.a.maxLength).toBe(3)
  })
})

describe('usage mapping', () => {
  it('keeps the AI SDK v4 semantics the telemetry reads', () => {
    expect(
      toLegacyUsage({ input_tokens: 2000, output_tokens: 700, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 }),
    ).toEqual({
      usage: { promptTokens: 2000, completionTokens: 700, totalTokens: 2700 },
      providerMetadata: { anthropic: { cacheCreationInputTokens: 0, cacheReadInputTokens: 900 } },
    })
  })
})

describe('refusal handling', () => {
  // resolveLlmKeys is mocked above, so the client is never touched.
  const db = {} as never
  const refusal = new ClaudeRefusalError('claude-sonnet-5-5', 'general_harms')

  it('is recognised by name and by instance', () => {
    expect(isClaudeRefusal(refusal)).toBe(true)
    expect(isClaudeRefusal({ name: 'ClaudeRefusalError' })).toBe(true)
    expect(isClaudeRefusal(new Error('boom'))).toBe(false)
  })

  it('is neither transient nor a key fault, so failover never retries it or marks the key', () => {
    expect(classifyLlmError(refusal)).toBe('other')
  })

  it('withAnthropicOrOpenAi hands a Claude refusal to OpenAI', async () => {
    const anthropic = vi.fn(async () => {
      throw refusal
    })
    const openai = vi.fn(async () => 'openai-answer')
    const { result, usedProvider } = await withAnthropicOrOpenAi(db, 'project-1', anthropic, openai)
    expect(anthropic).toHaveBeenCalledTimes(1)
    expect(usedProvider).toBe('openai')
    expect(result).toBe('openai-answer')
  })

  it('still re-throws an unrelated Anthropic error instead of falling back', async () => {
    const err = Object.assign(new Error('invalid_request_error'), { status: 400 })
    await expect(
      withAnthropicOrOpenAi(db, 'project-1', async () => { throw err }, async () => 'x'),
    ).rejects.toBe(err)
  })
})
