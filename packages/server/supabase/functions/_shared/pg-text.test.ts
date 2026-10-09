import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'

import { pgSafeSlice, pgSafeText } from './pg-text.ts'

Deno.test('pgSafeText drops NUL characters', () => {
  assertEquals(pgSafeText('a\u0000b\u0000'), 'ab')
})

Deno.test('pgSafeText replaces a lone surrogate', () => {
  assertEquals(pgSafeText('x\uD83D'), 'x�')
  assertEquals(JSON.stringify(pgSafeText('x\uD83D')).includes('\\ud83d'), false)
})

Deno.test('pgSafeSlice never ends on half an emoji', () => {
  const s = 'ab😀'
  assertEquals(pgSafeSlice(s, 3), 'ab�')
  assertEquals(pgSafeSlice(s, 4), s)
})
