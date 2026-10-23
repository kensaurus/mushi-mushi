/**
 * FILE: skill-runs.test.ts
 * PURPOSE: Skill runs (ADR 0042): the round task an agent gets, and what a
 *          run does next from its round's report, fix attempt and review.
 */
import { describe, expect, it } from 'vitest'
import { SKILL_RUN_SKILLS, SKILL_TEXT_CAP, nextSkillRunStep, skillRunReport, skillRunSkill } from '../../supabase/functions/_shared/skill-runs.ts'

const a11y = skillRunSkill('audit-accessibility')!
const attempt = (over: Partial<NonNullable<Parameters<typeof nextSkillRunStep>[1]['attempt']>> = {}) => ({
  status: 'completed',
  failureCategory: null,
  prState: 'open',
  merged: false,
  prUrl: 'https://github.com/o/r/pull/5',
  ...over,
})

describe('skill catalog', () => {
  it('offers only measurable skills, each with what to measure', () => {
    expect(SKILL_RUN_SKILLS.length).toBeGreaterThan(10)
    for (const s of SKILL_RUN_SKILLS) expect(s.measure.length).toBeGreaterThan(20)
    expect(skillRunSkill('plan-pricing')).toBeNull()
  })
})

describe('skillRunReport', () => {
  it('states the scope, the measurement, the stop verdicts and the skill text', () => {
    const r = skillRunReport({ skill: a11y, skillTitle: 'Accessibility audit', skillBody: '# Steps\nRun axe.', skillUrl: 'https://github.com/kensaurus/skills', scope: 'the /settings pages', appName: 'glot.it', round: 1, roundsMax: 3, history: [] })
    expect(r.summary).toBe('Skill run 1/3: Accessibility (WCAG 2.2 AA) on the /settings pages')
    expect(r.description).toContain('Scope: the /settings pages')
    expect(r.description).toContain('axe-core violations')
    expect(r.description).toContain('Mushi verdict: already_fixed')
    expect(r.description).toContain('# Steps\nRun axe.')
    expect(r.description).not.toContain('Earlier rounds')
  })
  it('caps the skill text and names merged earlier rounds', () => {
    const r = skillRunReport({ skill: a11y, skillTitle: null, skillBody: 'x'.repeat(SKILL_TEXT_CAP + 500), skillUrl: null, scope: 's', appName: 'a', round: 2, roundsMax: 3, history: [{ round: 1, reportId: 'r1', outcome: 'merged', prUrl: 'https://github.com/o/r/pull/5' }] })
    expect(r.description).toContain('[… the rest of the skill')
    expect(r.description.length).toBeLessThan(SKILL_TEXT_CAP + 3_000)
    expect(r.description).toContain('round 1 https://github.com/o/r/pull/5')
  })
})

describe('nextSkillRunStep', () => {
  const run = { round: 1, roundsMax: 3, autoMerge: true }
  it('files the first round, waits while the agent works or the review runs', () => {
    expect(nextSkillRunStep(run, { reportStatus: null, attempt: null })).toEqual({ do: 'file' })
    expect(nextSkillRunStep(run, { reportStatus: 'classified', attempt: null }).do).toBe('wait')
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt({ status: 'running', prUrl: null }) }).do).toBe('wait')
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt(), reviewVerdict: null }).do).toBe('wait')
  })
  it('queues an Opus-approved round PR once, only with auto-merge on, never on a hold', () => {
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt(), reviewVerdict: 'merge' })).toEqual({ do: 'queue' })
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt(), reviewVerdict: 'merge', queued: true }).do).toBe('wait')
    expect(nextSkillRunStep({ ...run, autoMerge: false }, { reportStatus: 'fixing', attempt: attempt(), reviewVerdict: 'merge' }).do).toBe('wait')
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt(), reviewVerdict: 'hold' }).do).toBe('wait')
  })
  it('files the next round after a merge, and is done after the last', () => {
    expect(nextSkillRunStep(run, { reportStatus: 'fixed', attempt: attempt({ merged: true, prState: 'merged' }) })).toEqual({ do: 'file' })
    expect(nextSkillRunStep({ ...run, round: 3 }, { reportStatus: 'fixed', attempt: attempt({ merged: true }) })).toMatchObject({ do: 'done', outcome: 'merged' })
  })
  it('ends when the agent finds nothing left; stops on a person, another repo, a dismissal or a closed PR', () => {
    expect(nextSkillRunStep(run, { reportStatus: 'classified', attempt: attempt({ status: 'failed', failureCategory: 'already_fixed', prUrl: null }) })).toMatchObject({ do: 'done' })
    expect(nextSkillRunStep(run, { reportStatus: 'classified', attempt: attempt({ status: 'failed', failureCategory: 'needs_human', prUrl: null }) })).toMatchObject({ do: 'stop', outcome: 'needs_human' })
    expect(nextSkillRunStep(run, { reportStatus: 'classified', attempt: attempt({ status: 'failed', failureCategory: 'wrong_repo', prUrl: null }) })).toMatchObject({ do: 'stop' })
    expect(nextSkillRunStep(run, { reportStatus: 'dismissed', attempt: null })).toMatchObject({ do: 'stop', outcome: 'dismissed' })
    expect(nextSkillRunStep(run, { reportStatus: 'fixing', attempt: attempt({ prState: 'closed' }) })).toMatchObject({ do: 'stop', outcome: 'closed' })
    // A Cursor API error is not the agent's answer: spend-down may retry it.
    expect(nextSkillRunStep(run, { reportStatus: 'classified', attempt: attempt({ status: 'failed', failureCategory: 'cursor_api_error', prUrl: null }) }).do).toBe('wait')
  })
})
