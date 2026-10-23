import { describe, expect, it } from 'vitest'
import { cursorModelLabel } from './cursorModelLabel'

describe('cursorModelLabel', () => {
  it('reads the specs the follow-ups and spend-down store', () => {
    expect(cursorModelLabel('grok-4.7?reasoning_effort=xhigh&context=500k')).toBe('Grok 4.7 (Extra high, 500K)')
    expect(cursorModelLabel('claude-opus-5-5?effort=xhigh&context=1m')).toBe('Claude Opus 5.5 (Extra high, 1M)')
    expect(cursorModelLabel('gpt-5.6-sol?fast=true')).toBe('GPT 5.6 Sol (Fast)')
    expect(cursorModelLabel('composer-2.5')).toBe('Composer 2.5')
  })
  it('is null for no model', () => {
    expect(cursorModelLabel(null)).toBeNull()
    expect(cursorModelLabel('  ')).toBeNull()
  })
})
