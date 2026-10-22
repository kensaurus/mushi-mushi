/**
 * FILE: verify-workflow.test.ts
 * PURPOSE: The mushi-verify workflow Mushi hands a project (Plan 024). The
 *          copy embedded in _shared/verify-workflow.ts must equal
 *          docs/templates/mushi-verify.yml, the template that ships with the
 *          composite action; Mushi fills exactly two of its lines.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fillVerifyWorkflow,
  RUNS_ON_LINE,
  TEST_COMMAND_LINE,
  VERIFY_WORKFLOW_PATH,
  VERIFY_WORKFLOW_TEMPLATE,
  yamlDoubleQuoted,
  yamlLabel,
} from '../../supabase/functions/_shared/verify-workflow.ts'

const TEMPLATE_FILE = resolve(__dirname, '../../../../docs/templates/mushi-verify.yml')

describe('VERIFY_WORKFLOW_TEMPLATE', () => {
  it('equals docs/templates/mushi-verify.yml byte for byte', () => {
    expect(VERIFY_WORKFLOW_TEMPLATE).toBe(readFileSync(TEMPLATE_FILE, 'utf8'))
  })

  it('has each substituted line exactly once', () => {
    for (const line of [RUNS_ON_LINE, TEST_COMMAND_LINE]) {
      expect(VERIFY_WORKFLOW_TEMPLATE.split('\n').filter((l) => l === line)).toHaveLength(1)
    }
  })

  it('keeps the contract: pull_request (never pull_request_target), agent branches, least permissions, 20 minutes, pinned checkout', () => {
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/^on:\n  pull_request:/m)
    expect(VERIFY_WORKFLOW_TEMPLATE).not.toMatch(/^\s*pull_request_target\s*:/m)
    for (const prefix of ['cursor/', 'mushi/', 'copilot/']) expect(VERIFY_WORKFLOW_TEMPLATE).toContain(`startsWith(github.head_ref, '${prefix}')`)
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/permissions:\n  contents: read\n  checks: write\n/)
    expect(VERIFY_WORKFLOW_TEMPLATE).toContain('timeout-minutes: 20')
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/uses: actions\/checkout@[0-9a-f]{40}/)
    // The job's own check run is not "Mushi verify": that name is the result Mushi reads.
    expect(VERIFY_WORKFLOW_TEMPLATE).toMatch(/^\s+name: Mushi verify run$/m)
    expect(VERIFY_WORKFLOW_PATH).toBe('.github/workflows/mushi-verify.yml')
  })
})

describe('fillVerifyWorkflow', () => {
  it('is the template for the defaults', () => {
    expect(fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: null })).toBe(VERIFY_WORKFLOW_TEMPLATE)
  })

  it('writes the runner labels and the test command, and nothing else changes', () => {
    const out = fillVerifyWorkflow({ verifyRunsOn: ['self-hosted', 'alienware-glot-1'], verifyTestCommand: 'npx jest {files} --ci' })
    expect(out).toContain('    runs-on: [self-hosted, alienware-glot-1]\n')
    expect(out).toContain('          test-command: "npx jest {files} --ci"\n')
    const changed = out.split('\n').filter((l, i) => l !== VERIFY_WORKFLOW_TEMPLATE.split('\n')[i])
    expect(changed).toHaveLength(2)
  })

  it('quotes labels YAML would read as something else', () => {
    expect(yamlLabel('ubuntu-latest')).toBe('ubuntu-latest')
    expect(yamlLabel('1.0')).toBe("'1.0'")
    expect(yamlLabel('on')).toBe("'on'")
    expect(yamlLabel('-x')).toBe("'-x'")
    expect(() => yamlLabel('a b')).toThrow(/not a runner label/)
  })

  it('escapes quotes and backslashes in the command, and refuses a second line or an expression', () => {
    expect(yamlDoubleQuoted('pytest "{files}" -k a\\b')).toBe('"pytest \\"{files}\\" -k a\\\\b"')
    expect(() => fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: 'x {files}\nrm -rf /' })).toThrow()
    expect(() => fillVerifyWorkflow({ verifyRunsOn: ['ubuntu-latest'], verifyTestCommand: 'x {files} ${{ secrets.T }}' })).toThrow()
  })
})
