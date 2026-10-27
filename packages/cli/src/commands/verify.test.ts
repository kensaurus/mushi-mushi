import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ConfigModule from '../config.js'
import { errorReply, okReply, runCli, TEST_CONFIG, TEST_PROJECT_ID } from '../test-harness.js'
import { registerVerifyCommands } from './verify.js'

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ConfigModule>()
  return { ...actual, loadConfig: () => ({ ...TEST_CONFIG }) }
})

const YAML =
  'name: Mushi verify\njobs:\n  verify:\n    runs-on: [self-hosted, mushi-nuc]\n    steps:\n      - uses: kensaurus/mushi-mushi/.github/actions/fix-verify@master\n'
const OTHER = '22222222-3333-4444-8555-666666666666'

let tmp: string | null = null
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true })
  tmp = null
})

describe('mushi verify workflow', () => {
  it('prints the YAML for the configured project', async () => {
    const run = await runCli(registerVerifyCommands, ['verify', 'workflow'], () => okReply({ yaml: YAML }))
    expect(run.calls).toEqual([expect.objectContaining({ method: 'GET', path: `/v1/admin/projects/${TEST_PROJECT_ID}/verify-workflow` })])
    expect(run.stdout).toBe(YAML)
  })

  it('--project picks another project; --out writes the file, creating folders', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-verify-'))
    const out = join(tmp, '.github', 'workflows', 'mushi-verify.yml')
    const run = await runCli(registerVerifyCommands, ['verify', 'workflow', '--project', OTHER, '--out', out], () => okReply({ yaml: YAML.trimEnd() }))
    expect(run.calls[0]!.path).toBe(`/v1/admin/projects/${OTHER}/verify-workflow`)
    expect(readFileSync(out, 'utf8')).toBe(YAML)
    expect(run.stdout).toContain(`Wrote ${out}.`)
  })

  it('--json carries the YAML', async () => {
    const run = await runCli(registerVerifyCommands, ['verify', 'workflow', '--json'], () => okReply({ yaml: YAML }))
    expect(JSON.parse(run.stdout)).toEqual({ ok: true, projectId: TEST_PROJECT_ID, yaml: YAML })
  })

  it('fails on an API error or an empty answer, and writes nothing', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'mushi-verify-'))
    const refused = await runCli(registerVerifyCommands, ['verify', 'workflow'], () => errorReply(404, 'NOT_FOUND', 'Project not found'))
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr).toContain('NOT_FOUND')
    const empty = await runCli(registerVerifyCommands, ['verify', 'workflow', '--out', join(tmp, 'w.yml')], () => okReply({}))
    expect(empty.error?.message).toMatch(/sent no workflow/)
  })

  it('rejects a project id that is not a UUID', async () => {
    const run = await runCli(registerVerifyCommands, ['verify', 'workflow', '--project', 'acme'])
    expect(run.calls).toHaveLength(0)
    expect(run.error?.code).toBe('E_INVALID_INPUT')
  })

  it('refuses to write a reply that is not the Mushi verify workflow', async () => {
    const run = await runCli(registerVerifyCommands, ['verify', 'workflow'], () => okReply({ yaml: '<html>proxy login</html>' }))
    expect(run.error?.code).toBe('E_API_ERROR')
    expect(run.error?.message).toContain('not the Mushi verify workflow')
    expect(run.stdout).toBe('')
  })
})
