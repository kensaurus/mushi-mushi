import { describe, expect, it } from 'vitest'
import { okReply, runCli } from '../test-harness.js'
import { registerNudgeCommand } from './nudge.js'

const noFetch = () => okReply({})

describe('mushi nudge: numeric overrides', () => {
  it('rejects a fractional --max', async () => {
    const run = await runCli(registerNudgeCommand, ['nudge', '--max', '1.5'], noFetch)
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('--max must be a finite integer >= 1')
  })

  it('accepts a whole --max and a fractional --cooldown', async () => {
    const run = await runCli(registerNudgeCommand, ['nudge', '--max', '3', '--cooldown', '0.5'], noFetch)
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain('maxProactivePerSession: 3')
    expect(run.stdout).toContain('dismissCooldownHours: 0.5')
  })
})
