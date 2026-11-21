/**
 * FILE: packages/server/src/__tests__/claude-key-guard.test.ts
 * PURPOSE: An empty Claude key never reaches an Anthropic SDK.
 *
 * Why (2026-11-18): both Anthropic SDKs read the ANTHROPIC_API_KEY env var
 * when they get no apiKey. That skips the organization's AI provider switch
 * (ai-provider.ts): an organization on OpenAI gets no Claude key from
 * resolveLlmKeys, and a caller that passed the empty result on would still
 * have run Claude on the platform key. The same goes for routes that used the
 * env key when there was no project, and so no organization, to check.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const anthropicCtor = vi.hoisted(() => {
  // The platform Claude key is set, so only the code keeps a caller off it.
  ;(globalThis as { Deno?: unknown }).Deno = {
    env: { get: (k: string) => (k === 'ANTHROPIC_API_KEY' ? 'sk-ant-platform' : undefined) },
  }
  return vi.fn()
})
vi.mock('../../supabase/functions/_shared/ai-sdk.ts', () => ({
  Anthropic: class {
    beta = { messages: { create: async () => ({ model: 'm', stop_reason: 'end_turn', content: [], usage: {} }) } }
    constructor(opts: unknown) {
      anthropicCtor(opts)
    }
  },
}))

const { claudeGenerateText } = await import('../../supabase/functions/_shared/claude-messages.ts')
const { executeNaturalLanguageQuery } = await import('../../supabase/functions/_shared/nl-query.ts')

const FUNCTIONS_ROOT = resolve(__dirname, '../../supabase/functions')
const read = (file: string) => readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')

describe('claude-messages', () => {
  it('refuses an empty or missing key before building the SDK client', async () => {
    for (const apiKey of ['', '  ', undefined as unknown as string]) {
      anthropicCtor.mockClear()
      await expect(claudeGenerateText({ apiKey, model: 'claude-sonnet-5-5', prompt: 'hi' })).rejects.toThrow(/No Claude API key/)
      expect(anthropicCtor).not.toHaveBeenCalled()
    }
  })

  it('passes a real key to the SDK', async () => {
    anthropicCtor.mockClear()
    await claudeGenerateText({ apiKey: 'sk-ant-app', model: 'claude-sonnet-5-5', prompt: 'hi' }).catch(() => {})
    expect(anthropicCtor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-ant-app' }))
  })
})

describe('ai-sdk createAnthropic', () => {
  it('throws on an empty key instead of letting the provider read the env var', async () => {
    const actual = await vi.importActual<typeof import('../../supabase/functions/_shared/ai-sdk.ts')>(
      '../../supabase/functions/_shared/ai-sdk.ts',
    )
    expect(() => actual.createAnthropic({})).toThrow(/No Claude API key/)
    expect(() => actual.createAnthropic({ apiKey: '' })).toThrow(/No Claude API key/)
    expect(() => actual.createAnthropic({ apiKey: 'sk-ant-app' })).not.toThrow()
  })
})

describe('callers that held a Claude key past the switch', () => {
  it('ask-mushi never reads the env Claude key (with no project there is no organization to check)', () => {
    expect(read('api/routes/ask-mushi.ts')).not.toContain("Deno.env.get('ANTHROPIC_API_KEY')")
  })

  it('nl-query with no app refuses before any model call, though the env Claude key is set', async () => {
    anthropicCtor.mockClear()
    await expect(executeNaturalLanguageQuery({} as never, [], 'how many reports came in today?')).rejects.toThrow(/No app to query/)
    expect(anthropicCtor).not.toHaveBeenCalled()
    expect(read('_shared/nl-query.ts')).not.toContain("Deno.env.get('ANTHROPIC_API_KEY')")
  })

  it("mistake-summarizer takes the Haiku v4 fast path only on the app's own key, never with a route model", () => {
    // A key always arrives from withAnthropicOrOpenAi (no empty-key fallback to
    // ANTHROPIC_API_KEY); a platform key carries the route's 5.x model, which
    // only claude-messages.ts can call.
    const src = read('mistake-summarizer/index.ts')
    const fn = src.slice(src.indexOf('async function callLlm('))
    expect(fn.indexOf("if (!key.model && model === 'fast')")).toBeGreaterThan(-1)
    expect(fn.indexOf("if (!key.model && model === 'fast')")).toBeLessThan(fn.indexOf('anthropicFast(ANTHROPIC_HAIKU)'))
    expect(fn).toContain('withAnthropicOrOpenAi(')
  })
})
