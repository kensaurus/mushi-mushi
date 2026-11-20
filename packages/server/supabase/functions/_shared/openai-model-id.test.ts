import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { openAiCompatibleModelId, parseOpenAiModelMap } from './openai-model-id.ts'

Deno.test('a local server gets the operator-mapped model name, exactly as written', () => {
  const map = parseOpenAiModelMap(' gpt-6-luna = qwen3:8b , gpt-6.1-terra=qwen3:14b,,broken, =x, y= ')
  assertEquals([...map.entries()], [['gpt-6-luna', 'qwen3:8b'], ['gpt-6.1-terra', 'qwen3:14b']])
  assertEquals(openAiCompatibleModelId('gpt-6-luna', 'http://ollama:11434/v1', map), 'qwen3:8b')
  // An unmapped id keeps the usual rules.
  assertEquals(openAiCompatibleModelId('gpt-6.1-sol', 'http://ollama:11434/v1', map), 'gpt-6.1-sol')
  // A rename wins over the OpenRouter prefix.
  assertEquals(openAiCompatibleModelId('gpt-6-luna', 'https://openrouter.ai/api/v1', map), 'qwen3:8b')
})

Deno.test('without a map, OpenRouter ids are vendor-prefixed and others unchanged', () => {
  const none = parseOpenAiModelMap(undefined)
  assertEquals(openAiCompatibleModelId('gpt-6-luna', 'https://openrouter.ai/api/v1', none), 'openai/gpt-6-luna')
  assertEquals(openAiCompatibleModelId('openai/gpt-6-luna', 'https://openrouter.ai/api/v1', none), 'openai/gpt-6-luna')
  assertEquals(openAiCompatibleModelId('gpt-6-luna', 'https://api.openai.com/v1', none), 'gpt-6-luna')
  assertEquals(openAiCompatibleModelId('gpt-6-luna', undefined, none), 'gpt-6-luna')
})
