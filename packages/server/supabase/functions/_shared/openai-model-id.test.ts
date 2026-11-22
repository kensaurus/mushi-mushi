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

Deno.test('one operator model serves every chat id; embeddings keep their own setting', () => {
  const models = { map: parseOpenAiModelMap(undefined), chat: 'qwen3.8:27b', embedding: 'qwen3-embedding:4b' }
  for (const id of ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol']) {
    assertEquals(openAiCompatibleModelId(id, 'http://host.docker.internal:11434/v1', models), 'qwen3.8:27b')
  }
  assertEquals(openAiCompatibleModelId('text-embedding-3-small', 'http://host.docker.internal:11434/v1', models), 'qwen3-embedding:4b')
  // No embedding model chosen: an embedding id is never sent to the chat model.
  const chatOnly = { map: parseOpenAiModelMap(undefined), chat: 'gemma4:12b' }
  assertEquals(openAiCompatibleModelId('text-embedding-3-small', 'http://ollama:11434/v1', chatOnly), 'text-embedding-3-small')
})

Deno.test('a per-id rename wins over the one operator model', () => {
  const models = { map: parseOpenAiModelMap('gpt-6-luna=gemma4:12b'), chat: 'qwen3.8:27b' }
  assertEquals(openAiCompatibleModelId('gpt-6-luna', 'http://ollama:11434/v1', models), 'gemma4:12b')
  assertEquals(openAiCompatibleModelId('gpt-6.1-terra', 'http://ollama:11434/v1', models), 'qwen3.8:27b')
  // The operator's choice is sent as written, even to OpenRouter.
  assertEquals(openAiCompatibleModelId('gpt-6.1-terra', 'https://openrouter.ai/api/v1', models), 'qwen3.8:27b')
})
