/**
 * FILE: apps/admin/src/lib/askMushiCommands.test.ts
 * PURPOSE: Pin the slash-command registry shape and the caret-aware
 *          token detector that drives the Ask Mushi composer's `/` and
 *          `@` popovers. Both ship as pure functions exactly so we can
 *          test them without booting React + jsdom + a textarea.
 */

import { describe, expect, it } from 'vitest'
import {
  SLASH_COMMANDS,
  detectComposerToken,
  filterSlashCommands,
  findSlashCommand,
} from './askMushiCommands'

describe('SLASH_COMMANDS registry', () => {
  it('every command starts with /', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.command.startsWith('/')).toBe(true)
    }
  })

  it('every command has a unique token', () => {
    const seen = new Set<string>()
    for (const c of SLASH_COMMANDS) {
      expect(seen.has(c.command)).toBe(false)
      seen.add(c.command)
    }
  })

  it('local actions only ever use known action names', () => {
    for (const c of SLASH_COMMANDS) {
      if (c.effect.kind !== 'local') continue
      expect(['clear', 'help']).toContain(c.effect.action)
    }
  })

  it('model overrides only ever target known model aliases', () => {
    for (const c of SLASH_COMMANDS) {
      if (c.effect.kind !== 'model-override') continue
      expect(['sonnet', 'haiku', 'gpt']).toContain(c.effect.model)
    }
  })
})

describe('findSlashCommand', () => {
  it('matches an exact command', () => {
    expect(findSlashCommand('/tldr')?.command).toBe('/tldr')
  })

  it('is case-insensitive', () => {
    expect(findSlashCommand('/TLDR')?.command).toBe('/tldr')
  })

  it('returns undefined for non-slash tokens', () => {
    expect(findSlashCommand('tldr')).toBeUndefined()
  })

  it('returns undefined for unknown commands', () => {
    expect(findSlashCommand('/nope')).toBeUndefined()
  })
})

describe('filterSlashCommands', () => {
  it('returns the full registry on empty query', () => {
    expect(filterSlashCommands('').length).toBe(SLASH_COMMANDS.length)
  })

  it('matches by partial command token', () => {
    const matches = filterSlashCommands('tld')
    expect(matches.some((c) => c.command === '/tldr')).toBe(true)
  })

  it('matches by alias', () => {
    const matches = filterSlashCommands('summarise')
    expect(matches.some((c) => c.command === '/tldr')).toBe(true)
  })

  it('strips a leading slash from the query', () => {
    expect(filterSlashCommands('/why').some((c) => c.command === '/why-failed')).toBe(true)
  })
})

describe('detectComposerToken', () => {
  it('returns null when caret is in plain text', () => {
    expect(detectComposerToken('hello world', 5)).toBeNull()
  })

  it('detects a slash token at the start', () => {
    const tok = detectComposerToken('/tld', 4)
    expect(tok?.kind).toBe('slash')
    expect(tok?.query).toBe('tld')
    expect(tok?.tokenStart).toBe(0)
  })

  it('detects a slash token after whitespace', () => {
    const text = 'hey /sql'
    const tok = detectComposerToken(text, text.length)
    expect(tok?.kind).toBe('slash')
    expect(tok?.query).toBe('sql')
    expect(tok?.tokenStart).toBe(4)
  })

  it('detects an @-mention with a partial query', () => {
    const text = 'why did @repo'
    const tok = detectComposerToken(text, text.length)
    expect(tok?.kind).toBe('mention')
    expect(tok?.query).toBe('repo')
    expect(tok?.tokenStart).toBe(8)
  })

  it('keeps the token open across a colon (so @report:abc-123 works)', () => {
    const text = '@report:abc'
    const tok = detectComposerToken(text, text.length)
    expect(tok?.kind).toBe('mention')
    expect(tok?.query).toBe('report:abc')
  })

  it('closes the token at whitespace', () => {
    // Caret is after the trailing space — no active token.
    expect(detectComposerToken('/tldr ', 6)).toBeNull()
  })

  it('handles caret in the middle of a token', () => {
    const text = 'pre /tld more'
    const tok = detectComposerToken(text, 8) // caret right after `/tld`
    expect(tok?.kind).toBe('slash')
    expect(tok?.query).toBe('tld')
    expect(tok?.tokenStart).toBe(4)
  })

  it('clamps an out-of-range caret', () => {
    const tok = detectComposerToken('/tldr', 999)
    expect(tok?.kind).toBe('slash')
    expect(tok?.query).toBe('tldr')
  })
})
