import { describe, expect, it } from 'vitest'
import { buildMushiConnectCommand, buildMushiInitCommand } from './cliSetupCommands'

describe('cliSetupCommands', () => {
  const id = '11111111-2222-3333-4444-555555555555'

  it('builds init command with project id', () => {
    expect(buildMushiInitCommand(id)).toBe(`mushi init --project-id ${id}`)
  })

  it('builds connect command with endpoint and flags', () => {
    expect(buildMushiConnectCommand(id)).toBe(
      `MUSHI_API_KEY=mushi_xxx mushi connect --project-id ${id} ` +
        `--endpoint https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api --write-env --wire-ide --wait`,
    )
  })
})
