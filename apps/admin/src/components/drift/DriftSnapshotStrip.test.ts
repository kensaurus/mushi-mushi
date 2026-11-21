import { describe, expect, it } from 'vitest'
import { driftFirstStep } from './DriftSnapshotStrip'

// Console audit 2026-11-21: Schema changes said "No baseline scan yet" right after
// Full-stack audit's daily schema read listed changed tables.
describe('driftFirstStep', () => {
  it('leads with the daily schema read when it has a result, and names its source', () => {
    const step = driftFirstStep({ ranAt: new Date(Date.now() - 6 * 3_600_000).toISOString(), open: 5 })
    expect(step.title).toBe('5 schema changes from the daily schema read')
    expect(step.title).not.toContain('No baseline')
    expect(step.sentence).toContain('Full-stack audit reads your Supabase schema every day')
    expect(step.action).toEqual({ label: 'Open the schema findings', to: '/fullstack-audit#check-schema_drift' })
    expect((step.learnMore as { to?: string } | undefined)?.to).toBe('/health?view=schema&tab=scanner')
  })

  it('says the daily read found nothing open when it ran clean', () => {
    expect(driftFirstStep({ ranAt: null, open: 0 }).title).toBe('No open schema changes in the daily schema read')
  })

  it('keeps the first-scan step when the daily read never ran', () => {
    const step = driftFirstStep(null)
    expect(step.title).toBe('No baseline scan yet')
    expect(step.action.label).toBe('Run first scan')
  })
})
