/**
 * Plan 023 Phase 1 (local models): base URL validation for OpenAI-compatible
 * and Anthropic endpoints, where Anthropic calls go, the MUSHI_LLM_MODEL_*
 * overrides, Ollama cloud refusal, the local-server probe, and the one
 * stricter retry on a schema miss.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isPrivateLlmHost,
  privateLlmEndpointsAllowed,
  probeByokKey,
  validateAnthropicBaseUrl,
  validateOpenAiBaseUrl,
} from '../../supabase/functions/_shared/byok-validation.ts'
import {
  effectiveModelId,
  isOllamaCloudModel,
  LocalOnlyModelError,
  modelOverride,
  modelTierOf,
  withModelOverrides,
} from '../../supabase/functions/_shared/llm-model-env.ts'
import {
  anthropicAiSdkOptions,
  anthropicBaseUrlFor,
  rememberAnthropicBaseUrl,
} from '../../supabase/functions/_shared/llm-endpoints.ts'
import { claudeModelTraits, resolveClaudeModel, buildClaudeRequest } from '../../supabase/functions/_shared/claude-request.ts'
import { retryOnSchemaMiss, STRICT_JSON_RETRY_INSTRUCTION } from '../../supabase/functions/_shared/structured-retry.ts'

const ON = { allowPrivate: true }
const OFF = { allowPrivate: false }

let env: Record<string, string> = {}
const g = globalThis as { Deno?: unknown }
const hadDeno = 'Deno' in g
const realDeno = g.Deno
beforeEach(() => {
  env = {}
  g.Deno = { env: { get: (k: string) => env[k] } }
})
afterEach(() => {
  if (hadDeno) g.Deno = realDeno
  else delete g.Deno
})

describe('isPrivateLlmHost', () => {
  it('accepts loopback, private ranges, local names and compose service names', () => {
    for (const h of ['localhost', '127.0.0.1', '[::1]', '10.1.2.3', '192.168.0.9', '172.20.0.5', '100.100.1.1', 'ollama', 'gpu.lan', 'llm.internal', 'box.local', '[fd00::5]']) {
      expect(isPrivateLlmHost(h), h).toBe(true)
    }
  })
  it('refuses public hosts, link-local and metadata names', () => {
    for (const h of ['api.openai.com', '8.8.8.8', '169.254.169.254', '[fe80::1]', 'metadata.google.internal', 'metadata', '[::ffff:8.8.8.8]']) {
      expect(isPrivateLlmHost(h), h).toBe(false)
    }
  })
})

describe('privateLlmEndpointsAllowed', () => {
  it('is on with MUSHI_LOCAL_ONLY or MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT, off otherwise', () => {
    expect(privateLlmEndpointsAllowed()).toBe(false)
    env.MUSHI_LOCAL_ONLY = '1'
    expect(privateLlmEndpointsAllowed()).toBe(true)
    env = { MUSHI_ALLOW_PRIVATE_LLM_ENDPOINT: 'true' }
    expect(privateLlmEndpointsAllowed()).toBe(true)
  })
})

describe('validateOpenAiBaseUrl', () => {
  const matrix: Array<[string, boolean, boolean]> = [
    // url, ok when private allowed, ok when not
    ['https://api.openai.com/v1', true, true],
    ['http://api.openai.com/v1', false, false],
    ['https://api.openai.com:8443/v1', false, false],
    ['https://evil.example/v1', false, false],
    ['http://localhost:11434/v1', true, false],
    ['http://127.0.0.1:8000/v1', true, false],
    ['http://ollama:11434/v1', true, false],
    ['http://10.0.0.7:1234/v1', true, false],
    ['https://vllm.internal/v1', true, false],
    ['http://169.254.169.254/latest', false, false],
    ['http://user:pw@localhost:11434/v1', false, false],
    ['http://localhost:11434/v1?x=1', false, false],
    ['ftp://localhost/v1', false, false],
  ]
  for (const [url, onOk, offOk] of matrix) {
    it(`${url}: ${onOk ? 'ok' : 'refused'} when allowed, ${offOk ? 'ok' : 'refused'} when not`, () => {
      expect(validateOpenAiBaseUrl(url, [], ON).ok).toBe(onOk)
      expect(validateOpenAiBaseUrl(url, [], OFF).ok).toBe(offOk)
    })
  }

  it('keeps the allowlist rule for public hosts', () => {
    expect(validateOpenAiBaseUrl('https://llm.corp.example/v1', ['llm.corp.example'], OFF).ok).toBe(true)
  })

  it('reads the env flags when no rule is passed', () => {
    expect(validateOpenAiBaseUrl('http://localhost:11434/v1').ok).toBe(false)
    env.MUSHI_LOCAL_ONLY = '1'
    expect(validateOpenAiBaseUrl('http://localhost:11434/v1')).toEqual({ ok: true, value: 'http://localhost:11434/v1' })
  })
})

describe('validateAnthropicBaseUrl', () => {
  it('defaults to api.anthropic.com and normalises to the API root', () => {
    expect(validateAnthropicBaseUrl(undefined, [], OFF)).toEqual({ ok: true, value: 'https://api.anthropic.com' })
    expect(validateAnthropicBaseUrl('https://api.anthropic.com/v1/', [], OFF)).toEqual({ ok: true, value: 'https://api.anthropic.com' })
  })
  it('accepts a local Ollama only when private endpoints are allowed', () => {
    expect(validateAnthropicBaseUrl('http://localhost:11434', [], ON)).toEqual({ ok: true, value: 'http://localhost:11434' })
    expect(validateAnthropicBaseUrl('http://localhost:11434', [], OFF).ok).toBe(false)
  })
  it('refuses other public hosts unless allowlisted, and plain http on public hosts always', () => {
    expect(validateAnthropicBaseUrl('https://gateway.example', [], ON).ok).toBe(false)
    expect(validateAnthropicBaseUrl('https://gateway.example', ['gateway.example'], OFF).ok).toBe(true)
    expect(validateAnthropicBaseUrl('http://gateway.example', ['gateway.example'], ON).ok).toBe(false)
  })
})

describe('Anthropic base URL resolution', () => {
  it('explicit, then the key, then ANTHROPIC_BASE_URL, then api.anthropic.com', () => {
    expect(anthropicBaseUrlFor('k-none')).toBe('https://api.anthropic.com')
    env = { MUSHI_LOCAL_ONLY: '1', ANTHROPIC_BASE_URL: 'http://ollama:11434/' }
    expect(anthropicBaseUrlFor('k-none')).toBe('http://ollama:11434')
    rememberAnthropicBaseUrl('k-1', 'http://10.0.0.2:11434')
    expect(anthropicBaseUrlFor('k-1')).toBe('http://10.0.0.2:11434')
    expect(anthropicBaseUrlFor('k-1', 'https://api.anthropic.com')).toBe('https://api.anthropic.com')
    rememberAnthropicBaseUrl('k-1', undefined)
    expect(anthropicBaseUrlFor('k-1')).toBe('http://ollama:11434')
  })

  it('ignores an unsafe ANTHROPIC_BASE_URL instead of letting the SDK read it', () => {
    env = { ANTHROPIC_BASE_URL: 'http://localhost:11434' }
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(anthropicBaseUrlFor('k-x')).toBe('https://api.anthropic.com')
    errors.mockRestore()
  })

  it('gives the AI SDK the root plus /v1, and leaves an undefined key undefined', () => {
    env = { MUSHI_LOCAL_ONLY: '1', ANTHROPIC_BASE_URL: 'http://localhost:11434' }
    expect(anthropicAiSdkOptions('k')).toEqual({ apiKey: 'k', baseURL: 'http://localhost:11434/v1' })
    expect(anthropicAiSdkOptions(undefined)).toEqual({ baseURL: 'http://localhost:11434/v1' })
  })
})

describe('model overrides', () => {
  it('classifies vendor ids and leaves local ids alone', () => {
    expect(modelTierOf('claude-haiku-4-5')).toBe('fast')
    expect(modelTierOf('claude-sonnet-5-5')).toBe('smart')
    expect(modelTierOf('anthropic/claude-opus-5-5')).toBe('review')
    expect(modelTierOf('gpt-5.4-mini')).toBe('fast')
    expect(modelTierOf('gpt-5.4')).toBe('smart')
    expect(modelTierOf('qwen3:32b')).toBeNull()
  })

  it('does nothing when no override is set', () => {
    expect(effectiveModelId('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  })

  it('maps every Claude and GPT id to its class override, borrowing when a class is unset', () => {
    env = { MUSHI_LLM_MODEL_SMART: 'qwen3:32b' }
    expect(effectiveModelId('claude-haiku-4-5')).toBe('qwen3:32b')
    expect(effectiveModelId('gpt-5.4')).toBe('qwen3:32b')
    expect(effectiveModelId('claude-opus-5-5')).toBe('qwen3:32b')
    env = { MUSHI_LLM_MODEL_FAST: 'qwen3:4b', MUSHI_LLM_MODEL_SMART: 'qwen3:32b', MUSHI_LLM_MODEL_REVIEW: 'qwen3:235b' }
    expect(effectiveModelId('claude-haiku-5-5')).toBe('qwen3:4b')
    expect(effectiveModelId('gpt-5.4-mini')).toBe('qwen3:4b')
    expect(effectiveModelId('claude-sonnet-5-5')).toBe('qwen3:32b')
    expect(effectiveModelId('claude-opus-5-5')).toBe('qwen3:235b')
    expect(effectiveModelId('llama3.3:70b')).toBe('llama3.3:70b')
    expect(modelOverride('review')).toBe('qwen3:235b')
  })

  it('makes stored per-project Claude ids yield to the override', () => {
    expect(resolveClaudeModel('claude-sonnet-5-5', 'default')).toBe('claude-sonnet-5-5')
    env = { MUSHI_LLM_MODEL_SMART: 'qwen3:32b' }
    expect(resolveClaudeModel('claude-sonnet-5-5', 'qwen3:32b')).toBe('qwen3:32b')
    expect(resolveClaudeModel('llama3.3:70b', 'qwen3:32b')).toBe('llama3.3:70b')
  })

  it('refuses Ollama cloud tags in local-only mode only', () => {
    expect(isOllamaCloudModel('gpt-oss:120b-cloud')).toBe(true)
    expect(isOllamaCloudModel('kimi-k2:cloud')).toBe(true)
    expect(isOllamaCloudModel('qwen3:32b')).toBe(false)
    env = { MUSHI_LLM_MODEL_SMART: 'gpt-oss:120b-cloud' }
    expect(effectiveModelId('claude-sonnet-5-5')).toBe('gpt-oss:120b-cloud')
    env.MUSHI_LOCAL_ONLY = '1'
    expect(() => effectiveModelId('claude-sonnet-5-5')).toThrow(LocalOnlyModelError)
    expect(() => effectiveModelId('deepseek-v3.1:671b-cloud')).toThrow(/ollama\.com/)
  })

  it('wraps an AI SDK provider so it sends the mapped id', () => {
    env = { MUSHI_LLM_MODEL_FAST: 'qwen3:4b' }
    const provider = Object.assign(vi.fn((id: string, settings?: unknown) => ({ id, settings })), { chat: () => 'chat' })
    const wrapped = withModelOverrides(provider)
    expect(wrapped('claude-haiku-4-5', { a: 1 })).toEqual({ id: 'qwen3:4b', settings: { a: 1 } })
    expect((wrapped as unknown as { chat: () => string }).chat()).toBe('chat')
  })
})

describe('local model request shape', () => {
  it('sends temperature 0 and no Claude-only fields to a non-Claude model', () => {
    expect(claudeModelTraits('qwen3:32b')).toEqual({ acceptsSampling: true, effortLevels: [], serverSideFallback: false })
    const { body, betas } = buildClaudeRequest({ model: 'qwen3:32b', maxTokens: 100, prompt: 'hi', effort: 'medium' })
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('fallbacks')
    expect(body).not.toHaveProperty('output_config')
    expect(betas).toEqual([])
  })
})

describe('probeByokKey against a local server', () => {
  it('probes the Anthropic base URL and counts a 404 from a private host as up', async () => {
    const fetcher = vi.fn(async () => new Response('not found', { status: 404 }))
    const r = await probeByokKey('anthropic', 'ollama', 'http://localhost:11434', fetcher as unknown as typeof fetch)
    expect(fetcher.mock.calls[0]![0]).toBe('http://localhost:11434/v1/models')
    expect(r).toMatchObject({ status: 'ok', keyStatus: 'active' })
  })
  it('still treats a public 404 and a local 401 as failures', async () => {
    const notFound = vi.fn(async () => new Response('', { status: 404 }))
    expect((await probeByokKey('anthropic', 'k', undefined, notFound as unknown as typeof fetch)).status).toBe('error_network')
    expect(notFound.mock.calls[0]![0]).toBe('https://api.anthropic.com/v1/models')
    const denied = vi.fn(async () => new Response('', { status: 401 }))
    expect((await probeByokKey('openai', 'k', 'http://localhost:11434/v1', denied as unknown as typeof fetch)).status).toBe('error_auth')
  })
})

describe('retryOnSchemaMiss', () => {
  const miss = Object.assign(new Error('No object generated'), { name: 'AI_NoObjectGeneratedError', finishReason: 'stop' })

  it('retries once with the strict instruction after a schema miss', async () => {
    const attempt = vi.fn(async (strict: string | undefined) => {
      if (!strict) throw miss
      return 'ok'
    })
    await expect(retryOnSchemaMiss(attempt)).resolves.toBe('ok')
    expect(attempt.mock.calls).toEqual([[undefined], [STRICT_JSON_RETRY_INSTRUCTION]])
  })

  it('does not retry a truncated reply or another error, and a second miss throws', async () => {
    const truncated = Object.assign(new Error('x'), { name: 'AI_NoObjectGeneratedError', finishReason: 'length' })
    const once = vi.fn(async () => { throw truncated })
    await expect(retryOnSchemaMiss(once)).rejects.toBe(truncated)
    expect(once).toHaveBeenCalledTimes(1)
    const http = vi.fn(async () => { throw new Error('HTTP 500') })
    await expect(retryOnSchemaMiss(http)).rejects.toThrow('HTTP 500')
    expect(http).toHaveBeenCalledTimes(1)
    const twice = vi.fn(async () => { throw miss })
    await expect(retryOnSchemaMiss(twice)).rejects.toBe(miss)
    expect(twice).toHaveBeenCalledTimes(2)
  })
})
