import { describe, expect, it } from 'vitest'
import { splitPurpose } from './SettingsRow'

// Settings ran to 4,477px on two- and three-sentence row purposes (fresh-eyes 2026-11-18).
describe('splitPurpose', () => {
  it('keeps a short purpose whole', () => {
    expect(splitPurpose('Where Mushi Mushi tells you about new bugs.')).toEqual({ lead: 'Where Mushi Mushi tells you about new bugs.', more: null })
  })

  it('shows the first sentence of a long purpose and keeps the rest for the (i)', () => {
    const text =
      'Mushi Mushi stops starting fixes on its own once its fixes have cost this much in the last 30 days. Fixes you start yourself still run. Leave empty for no limit.'
    expect(splitPurpose(text)).toEqual({
      lead: 'Mushi Mushi stops starting fixes on its own once its fixes have cost this much in the last 30 days.',
      more: 'Fixes you start yourself still run. Leave empty for no limit.',
    })
  })

  it('does not split after an abbreviation', () => {
    const text = 'Paste a read-only token, e.g. one from your provider dashboard, so diagnoses can see table names. Leave empty to skip it.'
    expect(splitPurpose(text)).toEqual({
      lead: 'Paste a read-only token, e.g. one from your provider dashboard, so diagnoses can see table names.',
      more: 'Leave empty to skip it.',
    })
  })

  it('leaves one long sentence alone', () => {
    const one = 'A small line at the foot of the widget that links to Mushi Mushi and is shown by default on the Free plan only'
    expect(splitPurpose(one)).toEqual({ lead: one, more: null })
  })
})
