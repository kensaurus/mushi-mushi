import { describe, expect, it } from 'vitest'
import { flagLines } from './flags-view.js'

describe('mushi worker status prints the console\'s worker flags (ADR 0048 amendment 2026-10-28)', () => {
  it('worst first, with the cause, the stage, the last log lines and what to run', () => {
    const lines = flagLines([
      {
        id: 'run_stuck:c1',
        kind: 'run_stuck',
        severity: 'danger',
        hostname: 'alienware',
        title: 'glot: a run has held an agent space for 4 h 10 min',
        cause: "It has been in the repo's own commit hook (git commit) for 4 h.",
        sinceSec: 4 * 3600 + 600,
        stage: 'commit',
        log: ['commit: pnpm exec tsc --noEmit'],
        actions: [
          { kind: 'stop_run', label: 'Stop this run', claimId: '30000001-0000-4000-8000-000000000000' },
          { kind: 'open_report', label: 'Open the report', reportId: 'r1' },
          { kind: 'copy_command', label: 'Find it on the machine', command: 'ps -eo pid,etime,args' },
        ],
      },
      { id: 'account_check:h1', kind: 'account_check', severity: 'warn', hostname: 'alienware', title: 'The Cursor account check timed out on alienware', cause: 'It did not answer in time.', sinceSec: 900, actions: [{ kind: 'recheck_account', label: 'Re-check the account', hostId: 'h1' }] },
    ])
    expect(lines).toEqual([
      '2 problems with your local workers, 1 needs you now (worst first):',
      '  !! glot: a run has held an agent space for 4 h 10 min (for 4 h 10 min)',
      "     It has been in the repo's own commit hook (git commit) for 4 h.",
      '     stage: commit',
      '     | commit: pnpm exec tsc --noEmit',
      '     -> Stop this run: in the console (Pipeline → Workers), claim 30000001',
      '     -> Open the report: mushi reports show r1',
      '     -> Find it on the machine: ps -eo pid,etime,args',
      '   ! The Cursor account check timed out on alienware (for 15 min)',
      '     It did not answer in time.',
      '     -> Re-check the account: in the console (Pipeline → Workers), or run cursor-agent status on the machine',
    ])
  })

  it('prints nothing without flags, or from a server that sends none', () => {
    expect(flagLines([])).toEqual([])
    expect(flagLines(undefined)).toEqual([])
  })
})
