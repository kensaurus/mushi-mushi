import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CLAUDE_MODELS,
  ROLE_DEFAULTS,
  ROLE_RECOMMENDED,
  effectiveModelId,
  modelOptions,
  type LiveModel,
} from './claudeModels'

const live = (id: string, createdAt: string): LiveModel => ({ id, displayName: id, createdAt, line: null })

describe('modelOptions', () => {
  it('lists the current lineup first, Fable 5.1 and Opus 5.5 included', () => {
    const ids = modelOptions([], 'claude-sonnet-5-5').filter((o) => o.group === 'current').map((o) => o.id)
    expect(ids).toEqual(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  it('keeps a saved model that is in no list visible as "saved", first', () => {
    const opts = modelOptions([], 'claude-mystery-9')
    expect(opts[0]).toMatchObject({ id: 'claude-mystery-9', group: 'saved' })
  })

  it('shows a model the key lists that this file does not know, as new when newer than the lineup', () => {
    const opts = modelOptions(
      [live('claude-opus-5-5', '2026-09-22T00:00:00Z'), live('claude-haiku-5-5', '2026-10-07T00:00:00Z'), live('claude-opus-6', '2027-01-10T00:00:00Z')],
      'claude-opus-5-5',
    )
    expect(opts.find((o) => o.id === 'claude-opus-6')).toMatchObject({ group: 'current' })
    expect(opts.find((o) => o.id === 'claude-opus-6')?.label).toContain('new')
  })

  it('with a live list, drops older catalog models the key cannot use', () => {
    const opts = modelOptions([live('claude-opus-5-5', '2026-09-22T00:00:00Z')], 'claude-opus-5-5')
    expect(opts.some((o) => o.id === 'claude-opus-4-6')).toBe(false)
    expect(opts.some((o) => o.id === 'claude-fable-5-1')).toBe(true)
  })
})

describe('effectiveModelId', () => {
  it('maps column defaults and retired ids the way the server does', () => {
    expect(effectiveModelId(null, 'diagnosis')).toBe(ROLE_DEFAULTS.diagnosis)
    expect(effectiveModelId('claude-haiku-4-5-20251001', 'quick_check')).toBe('claude-haiku-4-5')
    expect(effectiveModelId('claude-opus-4-1', 'fix')).toBe(ROLE_DEFAULTS.fix)
    expect(effectiveModelId('claude-3-5-sonnet-20241022', 'judge')).toBe(ROLE_DEFAULTS.judge)
    expect(effectiveModelId('claude-opus-5-5', 'diagnosis')).toBe('claude-opus-5-5')
    expect(effectiveModelId('claude-fable-5-1', 'fix')).toBe('claude-fable-5-1')
  })
})

describe('recommendations', () => {
  const pricing = readFileSync(resolve(__dirname, '../../../../packages/server/supabase/functions/_shared/pricing.ts'), 'utf8')

  it('recommend and default only models in the catalog that the server can price', () => {
    for (const id of [...Object.values(ROLE_DEFAULTS), ...Object.values(ROLE_RECOMMENDED).map((r) => r.id)]) {
      expect(CLAUDE_MODELS.some((m) => m.id === id), id).toBe(true)
      expect(pricing.includes(`'${id}':`), `${id} priced in _shared/pricing.ts`).toBe(true)
    }
  })

  it('price every current model on the server too', () => {
    for (const m of CLAUDE_MODELS.filter((x) => x.current)) {
      expect(pricing.includes(`'${m.id}':`), m.id).toBe(true)
    }
  })

  it('never recommend the diagnosis model as its own judge', () => {
    expect(ROLE_RECOMMENDED.judge.id).not.toBe(ROLE_RECOMMENDED.diagnosis.id)
  })

  it('give every recommendation a reason and an https source with a read date', () => {
    for (const r of Object.values(ROLE_RECOMMENDED)) {
      expect(r.why.length).toBeGreaterThan(40)
      expect(r.sources.length).toBeGreaterThan(0)
      for (const s of r.sources) {
        expect(s.href).toMatch(/^https:\/\//)
        expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })
})
