/**
 * Mushi report 67f40c20: `gates` sent no findings, so dead_handler and
 * mock_leak always passed, and crawl was always skipped. A seeded dead
 * handler must now fail the gate; a run without lint evidence must fail
 * loudly instead of passing.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ESLint } from 'eslint'
import mushiPlugin from 'eslint-plugin-mushi-mushi'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALL_GATES,
  capFindings,
  judgeGateRuns,
  lintFindingsFromEslintReport,
  missingLintReport,
  parseGatesInput,
  readGateRuns,
} from './gates.js'

const core = vi.hoisted(() => ({
  inputs: {} as Record<string, string>,
  setFailed: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@actions/core', () => ({
  getInput: (name: string) => core.inputs[name] ?? '',
  setFailed: core.setFailed,
  setOutput: core.setOutput,
  info: core.info,
  warning: core.warning,
}))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mushi-gates-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.resetModules()
  core.setFailed.mockReset()
  core.setOutput.mockReset()
  core.info.mockReset()
  core.warning.mockReset()
})

/** Lint a seeded file with the real plugin and write ESLint's JSON report. */
async function seededReport(source: string): Promise<string> {
  const file = join(dir, 'src', 'Checkout.jsx')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(file, source)
  const eslint = new ESLint({
    cwd: dir,
    overrideConfigFile: true,
    overrideConfig: [{
      files: ['**/*.jsx'],
      languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
      plugins: { 'mushi-mushi': mushiPlugin as never },
      rules: { 'mushi-mushi/no-dead-handler': 'error', 'mushi-mushi/no-mock-leak': 'error' },
    }],
  })
  const results = await eslint.lintFiles([file])
  const formatter = await eslint.loadFormatter('json')
  const reportPath = join(dir, 'mushi-eslint.json')
  writeFileSync(reportPath, await formatter.format(results))
  return reportPath
}

const DEAD = `export function Checkout() {\n  return <button onClick={() => {}}>Pay</button>\n}\n`
const CLEAN = `export function Checkout({ pay }) {\n  return <button onClick={() => pay()}>Pay</button>\n}\n`

describe('lintFindingsFromEslintReport', () => {
  it('turns a seeded dead handler into an error finding for the dead_handler gate', async () => {
    const report = await seededReport(DEAD)
    const { readFileSync } = await import('node:fs')
    const findings = lintFindingsFromEslintReport(JSON.parse(readFileSync(report, 'utf8')), dir)
    expect(findings).toEqual([
      expect.objectContaining({
        gate: 'dead_handler',
        severity: 'error',
        rule_id: 'mushi-mushi/no-dead-handler',
        file_path: 'src/Checkout.jsx',
        line: 2,
      }),
    ])
  })

  it('ignores other rules and refuses a file that is not an ESLint report', () => {
    expect(lintFindingsFromEslintReport([{ filePath: '/x/a.ts', messages: [{ ruleId: 'no-unused-vars', severity: 2, message: 'x' }] }], '/x')).toEqual([])
    expect(() => lintFindingsFromEslintReport({ results: [] }, '/x')).toThrow(/not an ESLint JSON report/)
  })
})

describe('gate inputs', () => {
  it('"all" leaves crawl out, and an explicit crawl is refused with the reason', () => {
    expect(parseGatesInput('all')).toEqual({ gates: ALL_GATES })
    expect(ALL_GATES).not.toContain('crawl')
    expect(parseGatesInput('api_contract,crawl')).toMatchObject({ error: expect.stringContaining('Reconcile') })
  })

  it('lint gates without an eslint-report are refused; other gates need none', () => {
    expect(missingLintReport(['dead_handler', 'status_claim'], undefined)).toContain('eslint-report')
    expect(missingLintReport(['dead_handler'], 'r.json')).toBeNull()
    expect(missingLintReport(['status_claim', 'api_contract'], undefined)).toBeNull()
  })

  it('reads gate runs from the fixed and the older nested answer', () => {
    const runs = [{ gate: 'dead_handler', status: 'fail', findings_count: 1 }]
    expect(readGateRuns({ runs })).toEqual(runs)
    expect(readGateRuns({ ok: true, data: { runs } })).toEqual(runs)
    expect(readGateRuns({})).toBeNull()
  })

  it('caps findings at the server limit with errors first, so a cut never hides a failure', () => {
    const warn = { gate: 'mock_leak' as const, severity: 'warn' as const, rule_id: 'r', message: 'm' }
    const err = { ...warn, gate: 'dead_handler' as const, severity: 'error' as const }
    const out = capFindings([...Array.from({ length: 2_000 }, () => warn), err])
    expect(out.dropped).toBe(1)
    expect(out.findings).toHaveLength(2_000)
    expect(out.findings[0]).toEqual(err)
    expect(capFindings([err]).dropped).toBe(0)
  })

  it('an errored or missing gate counts against the run; a skip carries its reason', () => {
    const v = judgeGateRuns([
      { gate: 'status_claim', status: 'error', findings_count: 0 },
      { gate: 'api_contract', status: 'skipped', findings_count: 0, summary: { reason: 'no crawl data yet' } },
    ], ['status_claim', 'api_contract', 'orphan_endpoint'])
    expect(v.failed).toEqual(['status_claim'])
    expect(v.missing).toEqual(['orphan_endpoint'])
    expect(v.skipped).toEqual([{ gate: 'api_contract', reason: 'no crawl data yet' }])
  })
})

describe('mushi-mcp-ci gates (end to end through the CLI)', () => {
  let posted: Record<string, unknown> | null

  /** Run the CLI's gates command; the stub server fails dead_handler when it gets an error finding, like inventory-gates. */
  async function runGates(inputs: Record<string, string>): Promise<void> {
    posted = null
    core.inputs = { 'api-key': 'k', 'project-id': 'p', 'api-endpoint': 'https://api.test', command: 'gates', 'repo-root': dir, ...inputs }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>
      const findings = (posted.findings ?? []) as Array<{ gate: string; severity: string }>
      const runs = (posted.gates as string[]).map((gate) => {
        const mine = findings.filter((f) => f.gate === gate)
        const status = mine.some((f) => f.severity === 'error') ? 'fail' : 'pass'
        return { gate, status, findings_count: mine.length }
      })
      return new Response(JSON.stringify({ ok: true, data: { runs, overall: 'x' } }), { status: 200 })
    })
    await import('./cli.js')
    await vi.waitFor(() => expect(core.setOutput.mock.calls.length + core.setFailed.mock.calls.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
  }

  it('a seeded dead handler fails the dead_handler gate', async () => {
    const report = await seededReport(DEAD)
    await runGates({ gates: 'dead_handler,mock_leak', 'eslint-report': report })
    expect(posted?.findings).toEqual([expect.objectContaining({ gate: 'dead_handler', severity: 'error', file_path: 'src/Checkout.jsx' })])
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Mushi gate failures: dead_handler.'))
  })

  it('a clean report passes', async () => {
    const report = await seededReport(CLEAN)
    await runGates({ gates: 'dead_handler,mock_leak', 'eslint-report': report })
    expect(posted?.findings).toEqual([])
    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('lint gates without a report fail before anything is posted', async () => {
    await runGates({ gates: 'all' })
    expect(posted).toBeNull()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('no eslint-report was given'))
  })
})
