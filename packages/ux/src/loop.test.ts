// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest'
import { noScreensMessage } from './loop.js'

describe('a run that maps no screen', () => {
  it('blames the dev server when every page returned the same 5xx', () => {
    const skipped = ['/learn: HTTP 500', '/words: HTTP 500', '/alphabet: HTTP 500']
    const msg = noScreensMessage(skipped, "Error: Module not found: Can't resolve (<dynamic> | 'rrweb')")
    expect(msg.split('\n')[0]).toBe("No screen to work on: every page returned HTTP 500, so the app's dev server is failing, not the pages.")
    expect(msg).toContain("The dev server said: Error: Module not found: Can't resolve")
    expect(msg).toContain('dev command')
  })

  it('lists mixed reasons, and says so when nothing was found at all', () => {
    expect(noScreensMessage(['/a: it opens /b/ instead', '/c: HTTP 404'], null).split('\n')[0]).toBe(
      'No screen to work on: all 2 page(s) were skipped (it opens /b/ instead; HTTP 404).',
    )
    expect(noScreensMessage([], null)).toMatch(/^No screen to work on: mapping found no page/)
  })
})
