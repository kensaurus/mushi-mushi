import { describe, expect, it } from 'vitest'
import {
  buildMushiConnectCommand,
  buildMushiInitCommand,
  DOCTOR_DISPATCH_ONLY,
  DOCTOR_INGEST_ONLY,
} from './cliSetupCommands'

describe('cliSetupCommands', () => {
  const id = '11111111-2222-3333-4444-555555555555'

  it('builds init command with project id', () => {
    expect(buildMushiInitCommand(id)).toBe(`mushi init --project-id ${id}`)
  })

  it('connect targets the endpoint it is given, never a hard-coded cloud URL (QA bug 142)', () => {
    expect(buildMushiConnectCommand(id, 'https://mushi.selfhost.example/functions/v1/api')).toBe(
      `MUSHI_API_KEY=mushi_xxx mushi connect --project-id ${id} ` +
        `--endpoint https://mushi.selfhost.example/functions/v1/api --write-env --wire-ide --wait`,
    )
  })

  it('doctor commands use only the flags the CLI declares (QA bug 122)', () => {
    // packages/cli/src/commands/doctor-cli.ts declares --no-server and --no-ingest only.
    const declared = new Set(['--no-server', '--no-ingest'])
    for (const cmd of [DOCTOR_INGEST_ONLY, DOCTOR_DISPATCH_ONLY]) {
      const flags = cmd.split(' ').filter((t) => t.startsWith('--'))
      expect(flags.every((f) => declared.has(f))).toBe(true)
    }
    expect(DOCTOR_INGEST_ONLY).toBe('mushi doctor --no-server')
    expect(DOCTOR_DISPATCH_ONLY).toBe('mushi doctor --no-ingest')
  })
})
