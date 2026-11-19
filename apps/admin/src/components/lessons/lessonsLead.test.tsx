/**
 * @vitest-environment jsdom
 */

/**
 * FILE: apps/admin/src/components/lessons/lessonsLead.test.tsx
 * PURPOSE: Lessons leads with what the rules do and one button (2026-11-19), and rules in use are
 *          dense rows: severity glyph, a "seen N×" bar on one scale, the rule clamped with More.
 */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lessonsLead } from './LessonsSnapshotStrip'
import { EMPTY_LESSONS_STATS, type LessonsStats } from './LessonsStatsTypes'
import { LessonRuleRows, lessonSeverity, seenScale } from './LessonRuleRows'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const stats = (over: Partial<LessonsStats>): LessonsStats => ({ ...EMPTY_LESSONS_STATS, hasAnyProject: true, ...over })

describe('lessonsLead', () => {
  it('sends a ready pattern to Promote first', () => {
    expect(lessonsLead(stats({ activeLessons: 10, readyToPromote: 2, criticalLessons: 1 }))).toEqual({
      sentence: '10 rules guide every new diagnosis and fix. 2 recurring bugs are ready to become rules.',
      action: { label: 'Promote 2', tab: 'clusters' },
    })
  })

  it('asks to review critical rules next', () => {
    expect(lessonsLead(stats({ activeLessons: 4, criticalLessons: 1 })).action).toEqual({ label: 'Review rules', tab: 'lessons' })
  })

  it('offers Try a change when rules are in use and nothing is ready', () => {
    const lead = lessonsLead(stats({ activeLessons: 10, candidateClusters: 262, totalClusterReports: 262 }))
    expect(lead.sentence).toBe('10 rules guide every new diagnosis and fix. No recurring bug is ready to become a rule yet.')
    expect(lead.action).toEqual({ label: 'Try a change', tab: 'query' })
    expect(lead.sentence).not.toContain('Nothing to do')
  })

  it('has no button with no rules and nothing ready', () => {
    expect(lessonsLead(stats({ candidateClusters: 3 })).action).toBeNull()
  })
})

describe('LessonRuleRows', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('maps severity to a glyph tone and scales the bars to the most-seen rule', () => {
    expect(lessonSeverity('critical')).toEqual({ tone: 'danger', word: 'Critical' })
    expect(lessonSeverity('warn').tone).toBe('warn')
    expect(lessonSeverity('info').tone).toBe('info')
    expect(seenScale([{ frequency: 3 }, { frequency: 12 }])).toBe(12)
    expect(seenScale([])).toBe(1)
  })

  it('clamps a long rule to 2 lines, expands it with More, and retires from the row', () => {
    const onRetire = vi.fn()
    const long = 'Always pass an idempotency key to the payments API. '.repeat(5)
    act(() =>
      root.render(
        createElement(LessonRuleRows, {
          rows: [{ id: 'l1', rule_text: long, anti_pattern: 'Retrying a charge blindly', severity: 'critical' as const, frequency: 12, last_reinforced_at: new Date().toISOString(), retired_at: null }],
          retiring: null,
          canEdit: true,
          onRetire,
          onOpen: vi.fn(),
        }),
      ),
    )
    const text = host.querySelector('[data-testid="lesson-rule-text"]')!
    expect(text.className).toContain('line-clamp-2')
    expect(host.textContent).toContain('12×')
    const more = [...host.querySelectorAll('button')].find((b) => b.textContent === 'More')!
    act(() => more.click())
    expect(host.querySelector('[data-testid="lesson-rule-text"]')!.className).not.toContain('line-clamp-2')
    expect(host.textContent).toContain('Avoid: Retrying a charge blindly')
    const retire = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Retire')!
    act(() => retire.click())
    expect(onRetire).toHaveBeenCalledTimes(1)
  })
})
