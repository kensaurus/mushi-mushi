/**
 * The shell wordmark is the console h1 until a page passes
 * PageHeaderBar titleAs="h1". This round that is /fixes and /credits.
 * Later rounds and other pages should adopt the same prop.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(__dirname, 'pageH1.tsx'), 'utf8')

describe('page h1 pattern', () => {
  it('documents that later rounds and other pages should adopt titleAs="h1"', () => {
    expect(src).toContain('Later rounds and other console pages should adopt `titleAs="h1"`')
    expect(src).toContain('/fixes')
    expect(src).toContain('/credits')
    expect(src).toContain('the wordmark stays the only h1')
  })
})
