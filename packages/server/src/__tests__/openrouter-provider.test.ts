/**
 * OpenRouter as its own BYOK provider (2026-10-05).
 *
 * OpenRouter rejects OpenAI's bare model ids (its catalogue has
 * `openai/gpt-5.4`, not `gpt-5.4`), and an OpenRouter key sent to
 * api.openai.com 401s and gets marked auth_failed. These pin the id
 * qualification, the base URL every call site passes, and which features
 * leave OpenRouter keys out.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const seen: Array<{ baseURL?: string; modelId: string }> = []
vi.mock('npm:@ai-sdk/openai@1', () => ({
  createOpenAI: (opts: { baseURL?: string }) => {
    const provider = (modelId: string) => {
      seen.push({ baseURL: opts.baseURL, modelId })
      return { modelId }
    }
    return Object.assign(provider, { embedding: (id: string) => ({ id }) })
  },
}))

import {
  isOpenRouterBaseUrl,
  openAiCompatibleModelId,
  openAiProvider,
} from '../../supabase/functions/_shared/openai-compat.ts'

const FN = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(FN, rel), 'utf8')

describe('openAiCompatibleModelId', () => {
  it('prefixes bare ids for OpenRouter only', () => {
    expect(openAiCompatibleModelId('gpt-5.4', 'https://openrouter.ai/api/v1')).toBe('openai/gpt-5.4')
    expect(openAiCompatibleModelId('text-embedding-3-small', 'https://openrouter.ai/api')).toBe('openai/text-embedding-3-small')
    expect(openAiCompatibleModelId('anthropic/claude-sonnet-5.5', 'https://openrouter.ai/api/v1')).toBe('anthropic/claude-sonnet-5.5')
    expect(openAiCompatibleModelId('gpt-5.4', 'https://api.openai.com/v1')).toBe('gpt-5.4')
    expect(openAiCompatibleModelId('gpt-5.4', undefined)).toBe('gpt-5.4')
  })

  it('recognises only openrouter.ai hosts', () => {
    expect(isOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterBaseUrl('https://openrouter.ai.evil.example/v1')).toBe(false)
    expect(isOpenRouterBaseUrl('not a url')).toBe(false)
  })
})

describe('openAiProvider', () => {
  it('sends prefixed ids to OpenRouter and bare ids elsewhere', () => {
    seen.length = 0
    openAiProvider({ apiKey: 'k', baseURL: 'https://openrouter.ai/api/v1' })('gpt-5.4-mini')
    openAiProvider({ apiKey: 'k', baseURL: 'https://api.openai.com/v1' })('gpt-5.4-mini')
    openAiProvider({ apiKey: 'k' })('gpt-5.4')
    expect(seen.map((s) => s.modelId)).toEqual(['openai/gpt-5.4-mini', 'gpt-5.4-mini', 'gpt-5.4'])
  })
})

describe('call sites', () => {
  it('no edge function builds an OpenAI client directly', () => {
    const files = [
      'api/routes/ask-mushi.ts', 'api/routes/codebase-understand.ts', 'api/routes/repo-diagram.ts',
      'api/routes/sdk-assistant.ts', 'classify-report/index.ts', 'fast-filter/index.ts', 'fix-worker/index.ts',
      'intelligence-report/index.ts', 'judge-batch/index.ts', 'mistake-clusterer/index.ts',
      'mistake-summarizer/index.ts', 'pdca-runner/index.ts', 'release-builder/index.ts',
      'test-gen-from-report/index.ts', 'test-gen-from-story/index.ts', '_shared/store-ops-live.ts',
      '_shared/voice-intent.ts',
    ]
    for (const f of files) {
      const src = read(f)
      expect(src, f).not.toMatch(/createOpenAI\(/)
      expect(src, f).toMatch(/openAiProvider\(/)
    }
  })

  it('a resolved key always brings its base URL, so an OpenRouter key never reaches api.openai.com', () => {
    for (const f of ['pdca-runner/index.ts', 'test-gen-from-story/index.ts']) {
      expect(read(f), f).not.toMatch(/openAiProvider\(\{ apiKey: [A-Za-z.]+\.key \}\)/)
    }
  })

  it('embeddings send OpenRouter model names', () => {
    expect(read('_shared/embeddings.ts')).toMatch(/model: openAiCompatibleModelId\(embeddingModel, resolved\.baseUrl\)/)
  })

  it('speech-to-text and fine-tuning leave OpenRouter keys out', () => {
    expect(read('_shared/stt.ts')).toMatch(/\{ openAiOnly: true \}\)/)
    expect(read('_shared/fine-tune-vendor.ts')).toMatch(/resolveLlmKey\(db, projectId, 'openai', \{ openAiOnly: true \}\)/)
  })

  it('OpenRouter keys follow OpenAI keys in the OpenAI pool', () => {
    const byok = read('_shared/byok.ts')
    expect(byok).toMatch(/if \(provider === 'openai' && !opts\.openAiOnly\) \{\s*for \(const c of await byokPoolCandidates\(db, projectId, 'openrouter'\)\)/)
  })
})

describe('validation', () => {
  it('openrouter is a provider with a free probe, and Firecrawl tests no longer spend a credit', () => {
    const v = read('_shared/byok-validation.ts')
    expect(v).toMatch(/'openrouter',/)
    expect(v).toContain("url: 'https://openrouter.ai/api/v1/key'")
    expect(v).toContain("url: 'https://api.firecrawl.dev/v2/team/credit-usage'")
    expect(v).not.toContain("'https://api.firecrawl.dev/v1/search'")
    expect(read('_shared/firecrawl.ts')).toContain('/v2/team/credit-usage')
  })

  it('the migrations widen the CHECKs before moving rows', () => {
    const add = readFileSync(resolve(FN, '../migrations/20261005100000_byok_openrouter_provider.sql'), 'utf8')
    expect(add).toMatch(/provider_slug IN \('anthropic', 'openai', 'openrouter',/)
    expect(add).toMatch(/provider IN \('anthropic', 'openai', 'openrouter',/)
    expect(add).not.toMatch(/UPDATE/i)
    const move = readFileSync(resolve(FN, '../migrations/20261005100100_byok_move_openrouter_keys.sql'), 'utf8')
    expect(move).toMatch(/SET provider_slug = 'openrouter',\s*base_url = NULL/)
  })
})
