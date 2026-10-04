/**
 * FILE: apps/admin/src/lib/skillPipelines.test.ts
 * PURPOSE: /skills rules from console QA group C (2026-10-04): QA 24, QA 103,
 *          QA 105, QA 245.
 */

import { describe, expect, it } from 'vitest'
import {
  describePipelineCancel,
  nextCheckinStep,
  parseReportIdInput,
  pipelineCancelBody,
  resolveSkillsTab,
} from './skillPipelines'

const ID = '0f7f2b1a-1111-4222-8333-444455556666'

describe('resolveSkillsTab (QA 245)', () => {
  it('opens the catalog for an unknown or missing tab', () => {
    expect(resolveSkillsTab('foo')).toBe('catalog')
    expect(resolveSkillsTab(null)).toBe('catalog')
    expect(resolveSkillsTab('pipelines')).toBe('pipelines')
    expect(resolveSkillsTab('sources')).toBe('sources')
  })
})

describe('parseReportIdInput (QA 103)', () => {
  it('reads a full id or a pasted report link', () => {
    expect(parseReportIdInput(` ${ID} `)).toEqual({ kind: 'ok', id: ID })
    expect(parseReportIdInput(`https://kensaur.us/mushi-mushi/admin/reports/${ID.toUpperCase()}?tab=fix`)).toEqual({
      kind: 'ok',
      id: ID,
    })
    expect(parseReportIdInput('')).toEqual({ kind: 'empty' })
  })

  it('refuses a short id with the fix instead of a raw server error', () => {
    const res = parseReportIdInput('abc123de')
    expect(res.kind).toBe('invalid')
    if (res.kind === 'invalid') {
      expect(res.message).toMatch(/full report ID/)
      expect(res.message).not.toMatch(/uuid|syntax/i)
    }
  })
})

describe('describePipelineCancel (QA 24)', () => {
  it('never says only "cancelled" while an agent may still push', () => {
    const res = describePipelineCancel({ mode: 'cloud', stopped: 0, stillRunning: 1 })
    expect(res.tone).toBe('warn')
    expect(res.message).toMatch(/could not be stopped/)
    expect(res.message).toMatch(/cursor\.com\/agents/)
  })

  it('confirms a stopped agent and a plain handoff cancel', () => {
    expect(describePipelineCancel({ mode: 'cloud', stopped: 1, stillRunning: 0 }).message).toMatch(/agent was stopped/)
    expect(describePipelineCancel({ mode: 'handoff' })).toEqual({
      tone: 'success',
      message: 'Pipeline cancelled. No more steps will run.',
    })
  })

  it('says in the confirm what Mushi can and cannot stop', () => {
    expect(pipelineCancelBody('cloud')).toMatch(/Cursor Cloud to stop the agent/)
    expect(pipelineCancelBody('handoff')).toMatch(/local agent is not stopped/)
  })
})

describe('nextCheckinStep (QA 105)', () => {
  it('targets the first step that is not finished', () => {
    const steps = [
      { step_index: 2, status: 'pending', skill_slug: 'c' },
      { step_index: 0, status: 'passed', skill_slug: 'a' },
      { step_index: 1, status: 'running', skill_slug: 'b' },
    ]
    expect(nextCheckinStep(steps)?.skill_slug).toBe('b')
    expect(nextCheckinStep([{ step_index: 0, status: 'passed' }])).toBeNull()
  })
})
