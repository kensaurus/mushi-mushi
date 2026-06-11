import { describe, expect, it } from 'vitest'
import { tokenizeSnippet } from './highlightSnippet'

describe('tokenizeSnippet', () => {
  it('colours bash install commands', () => {
    const tokens = tokenizeSnippet('npm install @mushi-mushi/react', 'bash')
    expect(tokens.some((t) => t.kind === 'command' && t.text === 'npm')).toBe(true)
    expect(tokens.some((t) => t.kind === 'string' && t.text === '@mushi-mushi/react')).toBe(true)
  })

  it('colours tsx imports and strings', () => {
    const tokens = tokenizeSnippet("import { MushiProvider } from '@mushi-mushi/react'", 'tsx')
    expect(tokens.some((t) => t.kind === 'keyword' && t.text === 'import')).toBe(true)
    expect(tokens.some((t) => t.kind === 'string' && t.text.includes('@mushi-mushi/react'))).toBe(true)
    expect(tokens.some((t) => t.kind === 'type' && t.text === 'MushiProvider')).toBe(true)
  })
})
