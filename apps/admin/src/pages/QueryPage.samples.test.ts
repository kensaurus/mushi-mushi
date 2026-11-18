/**
 * SQL query listed the same sample questions twice on an empty page: chips
 * under the box and the prompt library below (console sweep, 2026-10-28).
 * The chips now wait until results replace the library. The page is too
 * heavy to render here, so this is pinned in source.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'QueryPage.tsx'), 'utf8')

describe('SQL query sample questions', () => {
  it('shows the chips only when the prompt library is gone', () => {
    expect(src).toContain("{queryMode === 'nl' && runs.length > 0 && (")
    // The library is the empty-state branch of the same runs check.
    expect(src).toMatch(/runs\.length > 0 \? \([\s\S]*?\) : \(\s*queryMode === 'nl' \? \(\s*<QueryPromptLibrary/)
  })
})

describe('SQL query layout (2026-11-18 fresh-eyes)', () => {
  it('gives the question box three rows and stacks the button under it on a phone', () => {
    expect(src).toMatch(/<div className="flex flex-col gap-2 items-stretch sm:flex-row">\s*<textarea\s*id="query-composer"/)
    expect(src).toMatch(/id="query-composer"[\s\S]*?rows=\{3\}/)
  })

  it('draws the Library empty states as plain lines, not dashed cards', () => {
    const library = src.slice(src.indexOf('<Section title="Library">'))
    expect(library).not.toContain('<EmptySectionMessage')
    expect(library.match(/<LibraryEmpty/g)).toHaveLength(3)
  })
})
