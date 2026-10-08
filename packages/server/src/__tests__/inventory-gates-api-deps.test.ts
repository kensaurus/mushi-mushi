/**
 * The API-contract, orphan-endpoint and unknown-call gates read only the
 * api_dep nodes the current inventory declares, not every node an earlier
 * snapshot left in the graph.
 */
import { describe, expect, it } from 'vitest'
import { apiDepServed, isApiCallPath, readDeclaredApiDeps } from '../../supabase/functions/inventory-gates/index.ts'

function fakeDb(nodes: Array<{ id: string; label: string }>, parsed: unknown) {
  return {
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        returns: async () => ({ data: nodes, error: null }),
        maybeSingle: async () => ({ data: parsed === undefined ? null : { parsed }, error: null }),
      }
      void table
      return chain
    },
  } as never
}

const nodes = [
  { id: '1', label: 'POST:/functions/v1/glot-ai-chat' },
  { id: '2', label: 'GET:/api/drills' },
]

describe('readDeclaredApiDeps', () => {
  it('drops nodes a superseded snapshot left behind', async () => {
    const parsed = { pages: [{ elements: [{ backend: [{ method: 'POST', path: '/functions/v1/glot-ai-chat' }] }] }] }
    expect(await readDeclaredApiDeps(fakeDb(nodes, parsed), 'p1')).toEqual([nodes[0]])
  })

  it('keeps every node when the current inventory cannot be read', async () => {
    expect(await readDeclaredApiDeps(fakeDb(nodes, undefined), 'p1')).toEqual(nodes)
  })
})

describe('apiDepServed', () => {
  const none = new Set<string>()
  it('counts a call to a deployed edge function as served, for any method', () => {
    const fns = new Set(['glot-ai-chat'])
    expect(apiDepServed('POST:/functions/v1/glot-ai-chat', none, fns)).toBe(true)
    expect(apiDepServed('GET:/functions/v1/glot-ai-chat/history?x=1', none, fns)).toBe(true)
    expect(apiDepServed('POST:/functions/v1/glot-ai-chat-v2', none, fns)).toBe(false)
  })

  it('still fails an API nobody serves', () => {
    expect(apiDepServed('GET:/api/drills', none, new Set(['glot-ai-chat']))).toBe(false)
    expect(apiDepServed('GET:/api/drills', new Set(['GET:/api/drills']), none)).toBe(true)
  })
})

describe('isApiCallPath', () => {
  it('ignores page prefetches, Next.js payloads and assets', () => {
    for (const p of ['/glot-it/', '/glot-it/chat/', '/glot-it/chat/__next._tree.txt', '/_next/static/chunks/a.js', '/icons/logo.svg', '/version.json', '/glot-it/images/manifest.json', '/__nextjs_original-stack-frames']) {
      expect(isApiCallPath(p)).toBe(false)
    }
  })

  it('keeps real calls, including a trailing-slash API path', () => {
    for (const p of ['/functions/v1/glot-ai-chat', '/api/drills', '/rest/v1/lessons?select=*', '/api/users/', '/api/export.json']) {
      expect(isApiCallPath(p)).toBe(true)
    }
  })
})
