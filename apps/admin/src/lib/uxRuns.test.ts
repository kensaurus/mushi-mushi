/**
 * FILE: apps/admin/src/lib/uxRuns.test.ts
 * PURPOSE: Pure helpers of the UX runs page: kept-edit counting and the
 *          folded "What the agent did" list.
 */

import { describe, expect, it } from 'vitest'
import { foldSteps, uxKeptEdits, problemLines } from './uxRuns'

describe('uxKeptEdits', () => {
  it('counts every kept attempt, so a screen improved in three steps counts three', () => {
    expect(uxKeptEdits([{ outcome: 'accepted' }, { outcome: 'no_change' }, { outcome: 'accepted' }, { outcome: 'rejected' }])).toBe(2)
    expect(uxKeptEdits([])).toBe(0)
  })
})

describe('foldSteps', () => {
  it('folds repeated searches and commands into one line', () => {
    const steps = ['[read] app/page.tsx', '[find] a search', '[find] a search', '[find] a search', '[edit] app/page.tsx', '[edit] app/page.tsx', '[run] a command'].join('\n')
    expect(foldSteps(steps)).toEqual(['[read] app/page.tsx', '[find] 3 searches', '[edit] app/page.tsx (×2)', '[run] a command'])
  })
})

// Owner 2026-11-18: vitals read as graded badges. The layout-shift line names
// CLS with its number so the screen renders it as one (components/reports/VitalText).
describe('problemLines', () => {
  it('names layout shift as a CLS value', () => {
    const lines = problemLines({ axe: [], overflowX: false, smallTargets: 0, consoleErrors: 0, cls: 0.31 })
    expect(lines).toEqual(['Layout shift: CLS 0.31'])
  })
})
