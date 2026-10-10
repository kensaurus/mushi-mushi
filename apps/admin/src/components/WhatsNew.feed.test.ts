/**
 * The "What's new" popover fetches public/changelog.json and silently shows
 * nothing when it fails to parse, so a broken feed never surfaces in the UI.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('public/changelog.json', () => {
  it('parses, and every entry has a unique id and a date', () => {
    const raw = readFileSync(join(__dirname, '../../public/changelog.json'), 'utf8')
    const feed = JSON.parse(raw) as { entries: Array<{ id?: string; date?: string }> }
    expect(feed.entries.length).toBeGreaterThan(0)
    for (const e of feed.entries) {
      expect(e.id).toBeTruthy()
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(new Set(feed.entries.map((e) => e.id)).size).toBe(feed.entries.length)
  })
})
