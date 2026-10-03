import { describe, expect, it } from 'vitest'
import { localLimitExceeded, pushVerdict, type RecipePushAnswer } from './report.js'

const base: RecipePushAnswer = { state: 'unknown', reason: 'Read 12 tokens at abcdef1 on main.', tokenCount: 12, findingsStored: 3 }

function answer(deviance: RecipePushAnswer['deviance']): RecipePushAnswer {
  return { ...base, deviance }
}

const scored = {
  status: 'warn' as const,
  runId: 'run-1',
  score: 37,
  clientScore: null,
  storedFindings: 3,
  droppedFindings: 0,
  gate: { enabled: false, failAbove: null, exceeded: false },
  action: { action: 'off' },
  reason: null,
}

describe('localLimitExceeded', () => {
  it('fails only above --max-score, and never on a null score', () => {
    expect(localLimitExceeded(41, 40)).toBe(true)
    expect(localLimitExceeded(40, 40)).toBe(false)
    expect(localLimitExceeded(null, 0)).toBe(false)
    expect(localLimitExceeded(90, null)).toBe(false)
  })
})

describe('pushVerdict', () => {
  it('passes when the project gate is off, whatever the score', () => {
    const v = pushVerdict(answer(scored), null, 37)
    expect(v.failed).toBe(false)
    expect(v.lines).toContain('Mushi scored 37/100: 3 findings stored.')
  })

  it("fails the step when the score is above the project's limit", () => {
    const v = pushVerdict(answer({ ...scored, gate: { enabled: true, failAbove: 30, exceeded: true } }), null, 37)
    expect(v.failed).toBe(true)
    expect(v.errors.join('\n')).toMatch(/Deviance score 37 is above this project's limit of 30/)
  })

  it('passes within the limit and says so', () => {
    const v = pushVerdict(answer({ ...scored, gate: { enabled: true, failAbove: 40, exceeded: false } }), null, 37)
    expect(v.failed).toBe(false)
    expect(v.lines).toContain("Within the project's limit of 40.")
  })

  it('never fails on an older server that sends no deviance, unless --max-score does', () => {
    expect(pushVerdict(base, null, 37).failed).toBe(false)
    expect(pushVerdict(answer(null), 30, 37).failed).toBe(true)
  })

  it('reports an engine mismatch, refused findings and what the auto-fix did', () => {
    const v = pushVerdict(answer({ ...scored, clientScore: 12, droppedFindings: 2, action: { action: 'dispatched', reportId: 'rep-1', newFindings: 2 } }), null, 12)
    expect(v.errors).toContain('This CLI scored 12, Mushi scored 37. Update @mushi-mushi/cli so both run the same rules.')
    expect(v.lines).toContain('Mushi scored 37/100: 3 findings stored, 2 refused.')
    expect(v.lines).toContain('Mushi dispatched a fix for 2 new findings (report rep-1).')
    expect(pushVerdict(answer({ ...scored, action: { action: 'autofix_disabled' } }), null, 37).lines.join('\n')).toMatch(/Autofix is off for this project/)
  })

  it('a scan Mushi could not store is reported but does not fail the host CI while the gate is off', () => {
    const v = pushVerdict(answer({ ...scored, status: 'error', score: null, reason: 'gate_findings insert failed: boom' }), null, 37)
    expect(v.failed).toBe(false)
    expect(v.errors).toContain('Mushi could not store the scan: gate_findings insert failed: boom')
  })

  it('fails the step when the gate is on and the scan could not be stored, even within the limit', () => {
    const within = { enabled: true, failAbove: 40, exceeded: false }
    const v = pushVerdict(answer({ ...scored, status: 'error', gate: within, reason: 'gate_findings insert failed: boom' }), null, 37)
    expect(v.failed).toBe(true)
    expect(v.errors.join('\n')).toMatch(/deviance gate is on, and an unstored scan cannot be checked/)
    // Above the limit it fails once, for both reasons.
    const over = pushVerdict(answer({ ...scored, status: 'error', gate: { enabled: true, failAbove: 30, exceeded: true }, reason: 'boom' }), null, 37)
    expect(over.failed).toBe(true)
  })

  it('says when a public key kept the auto-fix from running', () => {
    const v = pushVerdict(answer({ ...scored, action: { action: 'key_not_trusted', reason: 'key_seen_in_browser' }, reason: 'This key has been sent by a web page.' }), null, 37)
    expect(v.failed).toBe(false)
    expect(v.errors).toContain('This key has been sent by a web page.')
    expect(v.lines.join('\n')).toMatch(/auto-fix skipped for this push: the key is treated as public/)
  })
})
