// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 Kenji Sakuramoto / Kensaurus 合同会社 — Mushi Mushi
/**
 * The `gates` command's inputs and verdict, kept pure so they can be tested
 * without running the Action.
 *
 * Gates 1 and 2 (dead_handler, mock_leak) are lint gates: the server only
 * records the findings CI hands it. The command used to send none, so both
 * always passed (Mushi report 67f40c20). They now take the customer's ESLint
 * JSON report (eslint-plugin-mushi-mushi rules), and a run that asks for
 * them without a report fails before posting anything.
 */
import { relative, sep } from 'node:path'

const LINT_GATES = ['dead_handler', 'mock_leak'] as const
type LintGate = (typeof LINT_GATES)[number]

/**
 * @internal Exported for tests only.
 * `gates: all`. `crawl` is left out: inventory-gates always answers it
 * `skipped` (the crawler runs on its own, via Inventory → Reconcile), so
 * listing it here only added a gate that could never fail.
 */
export const ALL_GATES = ['dead_handler', 'mock_leak', 'api_contract', 'status_claim', 'orphan_endpoint', 'unknown_call']

const RULE_TO_GATE: Record<string, LintGate> = {
  'mushi-mushi/no-dead-handler': 'dead_handler',
  'mushi-mushi/no-mock-leak': 'mock_leak',
}

export interface LintFinding {
  gate: LintGate
  severity: 'warn' | 'error'
  rule_id: string
  message: string
  file_path?: string
  line?: number
  col?: number
}

export interface GateRun {
  gate: string
  status: string
  findings_count: number
  summary?: { reason?: string } & Record<string, unknown>
}

/** The gates to run, or why the input cannot be run. */
export function parseGatesInput(arg: string): { gates: string[] } | { error: string } {
  const gates = !arg || arg === 'all' ? [...ALL_GATES] : arg.split(',').map((g) => g.trim()).filter(Boolean)
  if (gates.includes('crawl')) {
    return {
      error:
        'The crawl gate is not run by the gates command: the server always skips it here. ' +
        'Start a crawl with Inventory → Reconcile in the console, then run the api_contract gate, which reads its result.',
    }
  }
  return { gates }
}

/** A plain reason the lint gates cannot run, or null when they can (or were not asked for). */
export function missingLintReport(gates: readonly string[], reportPath: string | undefined): string | null {
  const lint = gates.filter((g): g is LintGate => (LINT_GATES as readonly string[]).includes(g))
  if (lint.length === 0 || reportPath) return null
  return (
    `The ${lint.join(' and ')} gate${lint.length > 1 ? 's need' : ' needs'} lint findings, and no eslint-report was given. ` +
    'Run ESLint with eslint-plugin-mushi-mushi and pass its JSON report ' +
    '(eslint -f json -o mushi-eslint.json src/ ; eslint-report: mushi-eslint.json), ' +
    'or leave these gates out of the gates input.'
  )
}

interface EslintMessage {
  ruleId?: string | null
  severity?: number
  message?: string
  line?: number
  column?: number
}
interface EslintFileResult {
  filePath?: string
  messages?: EslintMessage[]
}

/**
 * Turn an ESLint JSON report (`eslint -f json`) into lint-gate findings.
 * Only the mushi-mushi dead-handler and mock-leak rules count. Throws when
 * the input is not an ESLint report, so a wrong file fails the step.
 */
export function lintFindingsFromEslintReport(report: unknown, repoRoot: string): LintFinding[] {
  if (!Array.isArray(report)) throw new Error('eslint-report is not an ESLint JSON report (expected an array of file results).')
  const findings: LintFinding[] = []
  for (const file of report as EslintFileResult[]) {
    if (!file || typeof file !== 'object' || !Array.isArray(file.messages)) {
      throw new Error('eslint-report is not an ESLint JSON report (a file result has no messages array).')
    }
    const filePath = typeof file.filePath === 'string'
      ? relative(repoRoot, file.filePath).split(sep).join('/')
      : undefined
    for (const m of file.messages) {
      const gate = m.ruleId ? RULE_TO_GATE[m.ruleId] : undefined
      if (!gate || !m.severity) continue
      findings.push({
        gate,
        severity: m.severity >= 2 ? 'error' : 'warn',
        rule_id: m.ruleId!,
        message: (m.message ?? m.ruleId!).slice(0, 2_000),
        ...(filePath ? { file_path: filePath } : {}),
        ...(typeof m.line === 'number' ? { line: m.line } : {}),
        ...(typeof m.column === 'number' ? { col: m.column } : {}),
      })
    }
  }
  return findings
}

/** The most findings one gates/run accepts (server: _shared/gate-evidence.ts). */
const MAX_FINDINGS = 2_000

/**
 * At most MAX_FINDINGS, errors first, so a cut never turns a failing gate
 * into a passing one. `dropped` is how many were left out.
 */
export function capFindings(findings: LintFinding[]): { findings: LintFinding[]; dropped: number } {
  if (findings.length <= MAX_FINDINGS) return { findings, dropped: 0 }
  const sorted = [...findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  return { findings: sorted.slice(0, MAX_FINDINGS), dropped: findings.length - MAX_FINDINGS }
}

/**
 * The gate runs from a gates/run answer. Servers before the proxy fix nested
 * them one level deeper (`data.data.runs`); both shapes are read so the step
 * does not silently see zero runs.
 */
export function readGateRuns(data: unknown): GateRun[] | null {
  const d = data as { runs?: unknown; data?: { runs?: unknown } } | undefined
  const runs = Array.isArray(d?.runs) ? d.runs : Array.isArray(d?.data?.runs) ? d.data.runs : null
  return runs as GateRun[] | null
}

/** Which requested gates failed, warned or were skipped (with the server's reason). */
export function judgeGateRuns(runs: readonly GateRun[], requested: readonly string[]): {
  failed: string[]
  warned: string[]
  skipped: Array<{ gate: string; reason: string }>
  missing: string[]
} {
  const seen = new Set(runs.map((r) => r.gate))
  return {
    failed: runs.filter((r) => r.status === 'fail' || r.status === 'error').map((r) => r.gate),
    warned: runs.filter((r) => r.status === 'warn').map((r) => r.gate),
    skipped: runs
      .filter((r) => r.status === 'skipped')
      .map((r) => ({ gate: r.gate, reason: typeof r.summary?.reason === 'string' ? r.summary.reason : 'no reason given' })),
    missing: requested.filter((g) => !seen.has(g)),
  }
}
