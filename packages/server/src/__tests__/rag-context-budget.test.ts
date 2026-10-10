/**
 * formatCodeContext promises a hard character budget, but always kept the
 * first block whole, so one oversized preview could blow the prompt budget.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const noop: Record<string, unknown> = {}
  for (const level of ['debug', 'info', 'warn', 'error', 'fatal', 'audit']) noop[level] = () => {}
  noop.child = () => noop
  return { log: noop, createLogger: () => noop }
})
vi.mock('../../supabase/functions/_shared/embeddings.ts', () => ({ createEmbedding: vi.fn() }))

import { formatCodeContext } from '../../supabase/functions/_shared/rag.ts'

const file = (filePath: string, size: number) => ({ filePath, preview: 'x'.repeat(size), similarity: 0.9 })

describe('formatCodeContext budget', () => {
  it('cuts a first block that alone exceeds maxChars and counts the rest as omitted', () => {
    const out = formatCodeContext([file('a.ts', 5000), file('b.ts', 10)], { maxChars: 1000 })
    expect(out).toContain('... truncated (context budget 1000 chars)')
    expect(out).toContain('... 1 more file(s) omitted (context budget 1000 chars)')
    expect(out).not.toContain('b.ts')
    expect(out.length).toBeLessThan(1200)
  })

  it('keeps blocks that fit and omits the rest as before', () => {
    const out = formatCodeContext([file('a.ts', 300), file('b.ts', 300), file('c.ts', 600)], { maxChars: 800 })
    expect(out).toContain('a.ts')
    expect(out).toContain('b.ts')
    expect(out).toContain('... 1 more file(s) omitted (context budget 800 chars)')
    expect(out).not.toContain('truncated')
  })
})
