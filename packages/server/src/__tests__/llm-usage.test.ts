/**
 * FILE: packages/server/src/__tests__/llm-usage.test.ts
 * PURPOSE: Pin the shared usage recorder (`_shared/llm-usage.ts`) and keep
 *          every paid model call writing an `llm_invocations` row.
 *
 * Why (2026-10-04): judge-batch, generate-synthetic, mistake-*, pdca-runner,
 * release-builder, test-gen-*, inventory-propose, story-mapper,
 * library-modernizer, prompt-auto-tune, nl-query, the classify-report vision
 * call and every embedding wrote no row. Their spend was missing from the
 * Costs page and the monthly budget, and platform-key calls were never
 * debited. The recorder runs on the request path, so it must never throw.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => noop }
  return { log: noop }
})

const {
  buildLlmUsageRecord,
  extractLlmUsage,
  recordLlmUsage,
  servedModel,
  withLlmUsage,
} = await import('../../supabase/functions/_shared/llm-usage.ts')

const FUNCTIONS_ROOT = resolve(__dirname, '../../supabase/functions')

/** A db whose `llm_invocations` inserts land in `rows`. */
function captureDb() {
  const rows: Array<Record<string, unknown>> = []
  const db = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        rows.push({ ...row, __table: table })
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db, rows }
}

afterEach(() => vi.unstubAllGlobals())

describe('extractLlmUsage', () => {
  it('reads AI SDK v4 names from a result', () => {
    expect(extractLlmUsage({ usage: { promptTokens: 12, completionTokens: 34 } })).toEqual({ inputTokens: 12, outputTokens: 34 })
  })

  it('reads AI SDK v5 names from a result', () => {
    expect(extractLlmUsage({ usage: { inputTokens: 5, outputTokens: 7 } })).toEqual({ inputTokens: 5, outputTokens: 7 })
  })

  it('prefers the v5 names when a result carries both', () => {
    expect(extractLlmUsage({ usage: { inputTokens: 1, promptTokens: 9, outputTokens: 2, completionTokens: 9 } }))
      .toEqual({ inputTokens: 1, outputTokens: 2 })
  })

  it('reads a bare usage object', () => {
    expect(extractLlmUsage({ promptTokens: 3, completionTokens: 4 })).toEqual({ inputTokens: 3, outputTokens: 4 })
  })

  it('reads an OpenAI embeddings body, including a gateway that only sends total_tokens', () => {
    expect(extractLlmUsage({ data: [], usage: { prompt_tokens: 42, total_tokens: 42 } })).toEqual({ inputTokens: 42, outputTokens: null })
    expect(extractLlmUsage({ usage: { total_tokens: 17 } })).toEqual({ inputTokens: 17, outputTokens: null })
  })

  it('reads the tokens an error carries (NoObjectGeneratedError spent them)', () => {
    const err = Object.assign(new Error('No object generated'), { usage: { promptTokens: 100, completionTokens: 50 } })
    expect(extractLlmUsage(err)).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  it('returns nulls for anything else, without throwing', () => {
    const none = { inputTokens: null, outputTokens: null }
    expect(extractLlmUsage(undefined)).toEqual(none)
    expect(extractLlmUsage(null)).toEqual(none)
    expect(extractLlmUsage('text')).toEqual(none)
    expect(extractLlmUsage({ usage: { promptTokens: 'many', completionTokens: Number.NaN } })).toEqual(none)
    expect(extractLlmUsage({ usage: { promptTokens: -1 } })).toEqual(none)
    const hostile = new Proxy({}, { get: () => { throw new Error('boom') } })
    expect(extractLlmUsage(hostile)).toEqual(none)
  })
})

describe('servedModel', () => {
  it('takes the model that served the call when the price table knows it', () => {
    expect(servedModel({ response: { modelId: 'claude-sonnet-5' } }, 'claude-sonnet-5-5')).toBe('claude-sonnet-5')
  })

  it('keeps the requested model when the served id is unpriced (dated OpenAI ids)', () => {
    expect(servedModel({ response: { modelId: 'gpt-4.1-2025-04-14' } }, 'gpt-4.1')).toBe('gpt-4.1')
    expect(servedModel({}, 'gpt-4.1')).toBe('gpt-4.1')
    expect(servedModel(null, 'gpt-4.1')).toBe('gpt-4.1')
  })
})

describe('buildLlmUsageRecord', () => {
  const ctx = { functionName: 'judge-batch', stage: 'judge', projectId: 'p1', model: 'claude-opus-4-7', keySource: 'byok' as const }

  it('builds a success row with tokens, cache counters and key source', () => {
    const rec = buildLlmUsageRecord(ctx, {
      result: {
        usage: { promptTokens: 10, completionTokens: 20 },
        experimental_providerMetadata: { anthropic: { cacheReadInputTokens: 5, cacheCreationInputTokens: 2 } },
      },
    })
    expect(rec).toMatchObject({
      functionName: 'judge-batch',
      stage: 'judge',
      projectId: 'p1',
      primaryModel: 'claude-opus-4-7',
      usedModel: 'claude-opus-4-7',
      fallbackUsed: false,
      status: 'success',
      errorMessage: null,
      inputTokens: 10,
      outputTokens: 20,
      keySource: 'byok',
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 2,
      // Recording a cost never starts billing for it.
      skipHostedBilling: true,
    })
  })

  it('marks a fallback model as a fallback', () => {
    const rec = buildLlmUsageRecord({ ...ctx, model: 'gpt-5.4-mini', primaryModel: 'claude-opus-4-7' }, { result: {} })
    expect(rec.fallbackUsed).toBe(true)
    expect(rec.usedModel).toBe('gpt-5.4-mini')
  })

  it('builds an error row with the spent tokens and a redacted message', () => {
    const err = Object.assign(new Error('401 invalid x-api-key sk-ant-abcdefghijklmnop'), { usage: { promptTokens: 7, completionTokens: 0 } })
    const rec = buildLlmUsageRecord(ctx, { error: err })
    expect(rec.status).toBe('error')
    expect(rec.inputTokens).toBe(7)
    expect(rec.errorMessage).toContain('sk-[redacted]')
    expect(rec.errorMessage).not.toContain('abcdefghijklmnop')
  })

  it('records a timeout as a timeout', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    expect(buildLlmUsageRecord(ctx, { error: err }).status).toBe('timeout')
  })

  it('lets explicit counts win over the result', () => {
    const rec = buildLlmUsageRecord(ctx, { result: { usage: { prompt_tokens: 9 } }, usage: { outputTokens: 0 } })
    expect(rec.inputTokens).toBe(9)
    expect(rec.outputTokens).toBe(0)
  })

  it('computes latency from startedAt', () => {
    const rec = buildLlmUsageRecord({ ...ctx, startedAt: Date.now() - 50 }, { result: {} })
    expect(rec.latencyMs).toBeGreaterThanOrEqual(50)
  })
})

describe('recordLlmUsage never throws', () => {
  it('resolves an error when Deno is not defined (logLlmInvocation reads Deno.env synchronously)', async () => {
    const { db, rows } = captureDb()
    // No Deno global here: the call must not throw into the caller.
    const out = recordLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1' }, { result: {} })
    await expect(out).resolves.toEqual({ error: expect.any(String) })
    expect(rows).toHaveLength(0)
  })

  it('resolves an error when the db client itself throws', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const db = { from: () => { throw new Error('db down') } }
    await expect(recordLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1' })).resolves.toEqual({ error: 'db down' })
  })

  it('resolves an error when the insert rejects', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const db = { from: () => ({ insert: () => Promise.reject(new Error('network')) }) }
    await expect(recordLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1' })).resolves.toEqual({ error: 'network' })
  })

  it('resolves the PostgREST error when the insert is rejected', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const db = { from: () => ({ insert: () => Promise.resolve({ error: { message: 'violates check constraint' } }) }) }
    await expect(recordLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1' })).resolves.toEqual({
      error: 'violates check constraint',
    })
  })

  it('is a no-op without a db client', async () => {
    await expect(recordLlmUsage(null, { functionName: 'f', model: 'gpt-4.1' })).resolves.toEqual({ error: 'no database client' })
  })

  it('writes the row with cost, tokens and key source', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const { db, rows } = captureDb()
    await expect(recordLlmUsage(db as never, {
      functionName: 'release-builder',
      stage: 'release-notes',
      projectId: 'p1',
      model: 'gpt-4.1',
      keySource: 'byok',
    }, { result: { usage: { promptTokens: 1_000_000, completionTokens: 0 } } })).resolves.toEqual({ error: null })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      __table: 'llm_invocations',
      function_name: 'release-builder',
      stage: 'release-notes',
      project_id: 'p1',
      used_model: 'gpt-4.1',
      status: 'success',
      input_tokens: 1_000_000,
      output_tokens: 0,
      key_source: 'byok',
      cost_usd: 2,
    })
  })

  it('prices an embedding row at the OpenAI embedding rate', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const { db, rows } = captureDb()
    await recordLlmUsage(db as never, {
      functionName: 'embeddings',
      stage: 'embedding',
      model: 'text-embedding-3-small',
      keySource: 'byok',
      skipHostedBilling: true,
    }, { result: { usage: { prompt_tokens: 1_000_000 } }, usage: { outputTokens: 0 } })
    expect(rows[0]).toMatchObject({ used_model: 'text-embedding-3-small', input_tokens: 1_000_000, cost_usd: 0.02 })
  })
})

describe('withLlmUsage', () => {
  it('returns the result and records it', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const { db, rows } = captureDb()
    const result = { text: 'hi', usage: { promptTokens: 3, completionTokens: 4 } }
    await expect(withLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1', keySource: 'byok' }, async () => result))
      .resolves.toBe(result)
    await Promise.resolve()
    expect(rows[0]).toMatchObject({ status: 'success', input_tokens: 3, output_tokens: 4 })
  })

  it('rethrows the original error, unchanged, after recording it', async () => {
    vi.stubGlobal('Deno', { env: { get: () => undefined } })
    const { db, rows } = captureDb()
    class ProviderError extends Error {}
    const err = new ProviderError('429 rate limit')
    await expect(withLlmUsage(db as never, { functionName: 'f', model: 'gpt-4.1', keySource: 'byok' }, async () => {
      throw err
    })).rejects.toBe(err)
    expect(rows[0]).toMatchObject({ status: 'error', function_name: 'f' })
  })
})

/**
 * Every call site that used to be invisible on the Costs page must now write
 * a row through the shared recorder.
 */
const LOGGED_SITES: Array<{ file: string; helper: RegExp }> = [
  { file: 'judge-batch/index.ts', helper: /recordLlmUsage\(/ },
  { file: 'generate-synthetic/index.ts', helper: /recordLlmUsage\(/ },
  { file: 'mistake-clusterer/index.ts', helper: /recordLlmUsage\(/ },
  { file: 'mistake-summarizer/index.ts', helper: /recordLlmUsage\(/ },
  { file: 'pdca-runner/index.ts', helper: /withLlmUsage\(/ },
  { file: 'release-builder/index.ts', helper: /recordLlmUsage\(/ },
  { file: 'test-gen-from-report/index.ts', helper: /withLlmUsage\(/ },
  { file: 'test-gen-from-story/index.ts', helper: /withLlmUsage\(/ },
  { file: 'inventory-propose/index.ts', helper: /withLlmUsage\(/ },
  { file: 'story-mapper/index.ts', helper: /withLlmUsage\(/ },
  { file: 'library-modernizer/index.ts', helper: /withLlmUsage\(/ },
  { file: 'prompt-auto-tune/index.ts', helper: /withLlmUsage\(/ },
  { file: '_shared/nl-query.ts', helper: /withLlmUsage\(/ },
  { file: 'classify-report/index.ts', helper: /withLlmUsage\(/ },
  { file: '_shared/embeddings.ts', helper: /recordLlmUsage\(/ },
  { file: 'api/routes/lessons.ts', helper: /recordLlmUsage\(/ },
]

describe('every paid model call writes an llm_invocations row', () => {
  for (const { file, helper } of LOGGED_SITES) {
    it(`${file} records its calls`, () => {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')
      expect(src).toMatch(/from '\.{1,2}\/(?:\.\.\/)?(?:_shared\/)?llm-usage\.ts'/)
      expect(src).toMatch(helper)
    })
  }

  it('records the generation calls each of those files makes, one wrapper per call', () => {
    // Call count per file must match recorder count, so a newly added call is
    // caught here rather than on the Costs page.
    const counts: Array<[string, RegExp, RegExp]> = [
      ['pdca-runner/index.ts', /\b(claudeGenerateObject|claudeGenerateText|generateObject|generateText)\(\{/g, /withLlmUsage\(/g],
      ['test-gen-from-report/index.ts', /\b(claudeGenerateObject|generateObject)\(\{/g, /withLlmUsage\(/g],
      ['test-gen-from-story/index.ts', /\b(claudeGenerateObject|generateObject)\(\{/g, /withLlmUsage\(/g],
      ['_shared/nl-query.ts', /\b(claudeGenerateObject|generateText)\(\{/g, /withLlmUsage\(/g],
    ]
    for (const [file, calls, wrappers] of counts) {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')
      expect([file, src.match(calls)?.length]).toEqual([file, src.match(wrappers)?.length])
    }
  })

  it('no caller both writes a row and passes a meter (that would bill twice)', () => {
    for (const file of ['inventory-propose/index.ts', 'story-mapper/index.ts']) {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')
      expect(src).not.toMatch(/extractUsage:/)
    }
  })

  it('the legacy llm_cost_usd writers moved to llm_invocations (Costs sums both tables)', () => {
    for (const file of ['mistake-clusterer/index.ts', 'mistake-summarizer/index.ts', 'release-builder/index.ts', 'pdca-runner/index.ts']) {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, file), 'utf8')
      expect([file, src.includes("from('llm_cost_usd')")]).toEqual([file, false])
    }
  })

  it('embeddings record cost but never debit the hosted wallet', () => {
    const src = readFileSync(resolve(FUNCTIONS_ROOT, '_shared/embeddings.ts'), 'utf8')
    expect(src).toMatch(/stage: 'embedding'[\s\S]{0,200}skipHostedBilling: true/)
    const telemetry = readFileSync(resolve(FUNCTIONS_ROOT, '_shared/telemetry.ts'), 'utf8')
    expect(telemetry).toMatch(/rec\.keySource === 'env' && rec\.projectId && !rec\.skipHostedBilling/)
  })
})

describe('hosted billing stays where it was before recording', () => {
  it('records without debiting unless the site opts in', () => {
    const base = { functionName: 'judge-batch', model: 'claude-opus-4-7', keySource: 'env' as const, projectId: 'p1' }
    expect(buildLlmUsageRecord(base, { result: {} }).skipHostedBilling).toBe(true)
    expect(buildLlmUsageRecord({ ...base, billHosted: true }, { result: {} }).skipHostedBilling).toBe(false)
    expect(buildLlmUsageRecord({ ...base, billHosted: true, skipHostedBilling: true }, { result: {} }).skipHostedBilling).toBe(true)
  })

  // Policy (2026-10-04): bill only what a user asked for, never background
  // maintenance. A new entry here is a pricing decision, not a refactor.
  it('only user-requested paths opt into hosted billing', () => {
    const optedIn = [
      '_shared/nl-query.ts',
      'inventory-propose/index.ts',
      'story-mapper/index.ts',
      'test-gen-from-report/index.ts',
      'test-gen-from-story/index.ts',
    ]
    const all = readdirSync(resolve(FUNCTIONS_ROOT, '.'), { recursive: true, withFileTypes: false }) as string[]
    const users = all
      .filter((f) => f.endsWith('.ts') && !f.includes('node_modules'))
      .filter((f) => /billHosted:\s*true/.test(readFileSync(resolve(FUNCTIONS_ROOT, f), 'utf8')))
      .map((f) => f.split('\\').join('/'))
    expect(users.sort()).toEqual(optedIn)
  })
})

describe('every opted-in path checks the wallet before calling the provider', () => {
  it('goes through withAnthropicOrOpenAi / withLlmFailover or calls hostedLlmPreflight', () => {
    for (const f of ['_shared/nl-query.ts', 'inventory-propose/index.ts', 'story-mapper/index.ts', 'test-gen-from-report/index.ts', 'test-gen-from-story/index.ts']) {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, f), 'utf8')
      expect(/withAnthropicOrOpenAi|withLlmFailover|hostedLlmPreflight/.test(src), f).toBe(true)
    }
  })
})

describe('background jobs use the project key first', () => {
  it('no job reads the platform key straight from the environment', () => {
    for (const f of ['generate-synthetic/index.ts', 'mistake-clusterer/index.ts', 'mistake-summarizer/index.ts', 'release-builder/index.ts']) {
      const src = readFileSync(resolve(FUNCTIONS_ROOT, f), 'utf8')
      expect(src, f).not.toMatch(/Deno\.env\.get\('(ANTHROPIC|OPENAI)_API_KEY'\)/)
      expect(src, f).toMatch(/projectLlmKey|resolveLlmKey/)
      expect(src, f).not.toMatch(/keySource: 'env'/)
    }
  })

  it('sdk-assistant and intelligence-report record the key source; the report is never billed', () => {
    const assistant = readFileSync(resolve(FUNCTIONS_ROOT, 'api/routes/sdk-assistant.ts'), 'utf8')
    expect(assistant.match(/^\s*keySource,\s*$/gm)?.length).toBe(2)
    const intel = readFileSync(resolve(FUNCTIONS_ROOT, 'intelligence-report/index.ts'), 'utf8')
    expect(intel.match(/^\s*keySource,\s*$/gm)?.length).toBe(2)
    expect(intel.match(/skipHostedBilling: true/g)?.length).toBe(2)
  })
})
