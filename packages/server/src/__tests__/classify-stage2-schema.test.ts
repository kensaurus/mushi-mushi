import { describe, expect, it } from 'vitest'
// `ai` is pinned to 4.3.19 in this package's devDependencies — the exact
// version `classify-report/index.ts` resolves through its `npm:ai@4`
// specifier. Not a new runtime dependency: it makes an existing implicit one
// explicit, so the conversion assertions below run against the same converter
// production uses instead of a hoisted copy that happened to be on disk.
import { zodSchema } from 'ai'
import {
  clampLlmText,
  stage2Schema,
  STAGE2_AREA_MAX,
  STAGE2_LENGTH_BUDGET_LINE,
  STAGE2_SUMMARY_MAX,
  STAGE2_TITLE_MAX,
} from '../../supabase/functions/_shared/classify-stage2-schema.ts'

/**
 * Regression cover for Sentry MUSHI-MUSHI-SERVER-20 —
 * "AI_NoObjectGeneratedError: No object generated: response did not match
 * schema", caused by a ~290-character `summary` against `z.string().max(200)`.
 */

const valid = {
  category: 'bug',
  severity: 'high',
  summary: 'TypeError in CheckoutButton.handleSubmit',
  title: 'Checkout button does nothing on mobile',
  confidence: 0.8,
}

describe('clampLlmText', () => {
  it('leaves text within budget untouched', () => {
    expect(clampLlmText('short', 200)).toBe('short')
  })

  it('trims surrounding whitespace', () => {
    expect(clampLlmText('  padded  ', 200)).toBe('padded')
  })

  it('truncates without leaving a trailing space', () => {
    expect(clampLlmText('abcde fghij', 6)).toBe('abcde')
  })
})

describe('stage2Schema length handling', () => {
  /**
   * The exact failure: one field 90 characters over budget discarded the
   * entire classification. It must now parse and clamp.
   */
  it('accepts a 290-character summary instead of throwing', () => {
    const overlong = 'x'.repeat(290)
    const parsed = stage2Schema.parse({ ...valid, summary: overlong })
    expect(parsed.summary).toHaveLength(STAGE2_SUMMARY_MAX)
    // Everything else survives — that is the point of the fix.
    expect(parsed.category).toBe('bug')
    expect(parsed.severity).toBe('high')
    expect(parsed.title).toBe(valid.title)
    expect(parsed.confidence).toBe(0.8)
  })

  it('clamps an over-long title rather than failing the object', () => {
    const parsed = stage2Schema.parse({ ...valid, title: 'y'.repeat(300) })
    expect(parsed.title).toHaveLength(STAGE2_TITLE_MAX)
    expect(parsed.summary).toBe(valid.summary)
  })

  /** The tightest cap in the object, and the likeliest to overflow. */
  it('clamps an over-long area rather than failing the object', () => {
    const parsed = stage2Schema.parse({ ...valid, area: 'Checkout and Payments and Billing' })
    expect(parsed.area).toHaveLength(STAGE2_AREA_MAX)
  })

  it('keeps area optional', () => {
    expect(stage2Schema.parse(valid).area).toBeUndefined()
  })

  it('still rejects genuinely malformed output', () => {
    expect(() => stage2Schema.parse({ ...valid, category: 'not-a-category' })).toThrow()
    expect(() => stage2Schema.parse({ ...valid, confidence: 5 })).toThrow()
    expect(() => stage2Schema.parse({ ...valid, summary: 123 })).toThrow()
  })

  it('exposes every budget in the prompt line', () => {
    expect(STAGE2_LENGTH_BUDGET_LINE).toContain(String(STAGE2_SUMMARY_MAX))
    expect(STAGE2_LENGTH_BUDGET_LINE).toContain(String(STAGE2_TITLE_MAX))
    expect(STAGE2_LENGTH_BUDGET_LINE).toContain(String(STAGE2_AREA_MAX))
  })
})

/**
 * Guards the real risk of the fix. Swapping `.max()` for `.transform()` turns
 * each capped field into a ZodEffects; if the AI SDK's Zod→JSON-Schema
 * conversion did not see through that, the model would be handed a schema
 * with no `summary`/`title`/`area` at all — trading one failure for a worse,
 * quieter one.
 */
describe('AI SDK schema conversion survives the clamping transform', () => {
  const json = zodSchema(stage2Schema).jsonSchema as {
    type?: string
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>
    required?: string[]
  }

  it('still emits an object with all the Stage 2 properties', () => {
    expect(json.type).toBe('object')
    for (const field of [
      'category',
      'severity',
      'summary',
      'title',
      'area',
      'component',
      'rootCause',
      'reproductionSteps',
      'suggestedFix',
      'confidence',
      'bugOntologyTags',
      'inventoryNodeId',
    ]) {
      expect(json.properties?.[field], `missing property: ${field}`).toBeDefined()
    }
  })

  it('still types the clamped fields as strings', () => {
    expect(json.properties?.summary?.type).toBe('string')
    expect(json.properties?.title?.type).toBe('string')
    expect(json.properties?.area?.type).toBe('string')
  })

  /** The cap must reach the model as prose — that is what it actually obeys. */
  it('states each character budget in the field description', () => {
    expect(json.properties?.summary?.description).toContain(String(STAGE2_SUMMARY_MAX))
    expect(json.properties?.title?.description).toContain(String(STAGE2_TITLE_MAX))
    expect(json.properties?.area?.description).toContain(String(STAGE2_AREA_MAX))
  })

  it('keeps the required/optional split intact', () => {
    expect(json.required).toContain('summary')
    expect(json.required).toContain('title')
    expect(json.required).not.toContain('area')
  })
})
