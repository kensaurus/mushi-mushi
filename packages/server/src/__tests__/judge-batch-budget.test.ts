/**
 * FILE: judge-batch-budget.test.ts
 * PURPOSE: The judge cron skips a project that is over its monthly LLM
 *          budget without a per-report error. Covers the pre-check, a
 *          budget error thrown by the model call after that pre-check
 *          passed, and the `budgetHit` declaration that tsc can narrow
 *          to `never` after the concurrent loop.
 *
 * DEPENDENCIES: vitest, typescript, the judge-batch handler, fake Supabase.
 * USAGE: `pnpm --filter @mushi-mushi/server exec vitest run src/__tests__/judge-batch-budget.test.ts`
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeDb, type FakeDb } from './__stubs__/fake-supabase.ts'
import { LlmBudgetExceededError } from '../../supabase/functions/_shared/llm-budget.ts'

const h = vi.hoisted(() => ({
  served: null as null | ((req: Request) => Promise<Response>),
  db: null as FakeDb | null,
  logs: [] as Array<{ level: string; msg: string }>,
  failed: false,
  budgetCalls: [] as Array<{ projectId: string; provider: string }>,
  budgetByProject: {} as Record<string, 'over' | 'down' | 'ok'>,
  resolveCalls: [] as string[],
  generateCalls: 0,
  generateError: null as Error | null,
}))

vi.mock('../../supabase/functions/_shared/logger.ts', () => {
  const logger = {
    info: (msg: string) => h.logs.push({ level: 'info', msg }),
    warn: (msg: string) => h.logs.push({ level: 'warn', msg }),
    error: (msg: string) => h.logs.push({ level: 'error', msg }),
    fatal: (msg: string) => h.logs.push({ level: 'fatal', msg }),
    debug: () => {},
    child: () => logger,
  }
  return { log: logger, createLogger: () => logger }
})
vi.mock('../../supabase/functions/_shared/sentry.ts', () => ({
  withSentry: (_name: string, handler: (req: Request) => Promise<Response>) => handler,
  reportError: () => {},
  reportMessage: () => {},
}))
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({ requireServiceRoleAuth: () => null }))
vi.mock('../../supabase/functions/_shared/db.ts', () => ({ getServiceClient: () => h.db }))
vi.mock('../../supabase/functions/_shared/byok.ts', () => ({
  enforceLlmBudget: (_db: unknown, projectId: string, provider: string) => {
    h.budgetCalls.push({ projectId, provider })
    const action = h.budgetByProject[projectId] ?? 'ok'
    if (action === 'over') {
      throw new LlmBudgetExceededError(projectId, 50.02, 50, '2026-11-01T00:00:00.000Z')
    }
    if (action === 'down') throw new Error('connection reset')
    return Promise.resolve()
  },
  resolveLlmKey: async (_db: unknown, projectId: string) => {
    h.resolveCalls.push(projectId)
    return { key: 'test-key', source: 'byok' }
  },
}))
vi.mock('../../supabase/functions/_shared/telemetry.ts', () => ({
  startCronRun: async () => ({
    finish: async () => {},
    fail: async () => {
      h.failed = true
    },
  }),
}))
vi.mock('../../supabase/functions/_shared/observability.ts', () => ({
  createTrace: () => ({
    id: 'trace-1',
    span: () => ({ end: () => {} }),
    end: async () => {},
  }),
}))
vi.mock('../../supabase/functions/_shared/slack.ts', () => ({ sendSlackNotification: async () => {} }))
vi.mock('../../supabase/functions/_shared/prompt-ab.ts', () => ({
  recordPromptResult: () => Promise.resolve(),
  checkPromotionEligibility: async () => ({ shouldPromote: false }),
  promoteCandidate: async () => {},
  getPromptForStage: async () => ({ promptTemplate: null, promptVersion: null, judgeRubric: null }),
  resolveJudgeWeights: () => ({ accuracy: 0.35, severity: 0.25, component: 0.2, repro: 0.2 }),
}))
vi.mock('../../supabase/functions/_shared/llm-usage.ts', () => ({ recordLlmUsage: async () => {} }))
vi.mock('../../supabase/functions/_shared/plugins.ts', () => ({
  dispatchPluginEventDetached: () => Promise.resolve(),
}))
vi.mock('../../supabase/functions/_shared/claude-messages.ts', () => ({
  claudeGenerateObject: async () => {
    h.generateCalls++
    if (h.generateError) throw h.generateError
    return {
      object: {
        accuracy: 0.9,
        severity_calibration: 0.8,
        component_tagging: 0.7,
        repro_quality: 0.6,
        classification_agreed: true,
        reasoning: 'scores match the report',
        suggested_correction: null,
        disagreement_reason: null,
      },
      usage: { promptTokens: 10, completionTokens: 4 },
    }
  },
}))

const P_OVER = 'p-over'
const P_DOWN = 'p-down'
const P_OK = 'p-ok'

function settings(projectId: string) {
  return {
    project_id: projectId,
    judge_enabled: true,
    judge_model: null,
    judge_sample_size: 50,
    slack_webhook_url: null,
    discord_webhook_url: null,
    judge_fallback_provider: 'openai',
    judge_fallback_model: null,
  }
}

function report(projectId: string, id: string) {
  return {
    id,
    project_id: projectId,
    description: 'The save button does nothing',
    user_category: 'bug',
    category: 'bug',
    severity: 'medium',
    summary: 'Save does nothing',
    component: 'editor',
    confidence: 0.8,
    stage1_classification: { category: 'bug' },
    stage2_analysis: null,
    reproduction_steps: [],
    environment: null,
    console_logs: [],
    stage1_prompt_version: null,
    stage2_prompt_version: null,
    status: 'classified',
    judge_evaluated_at: null,
    reporter_token_hash: 'rk1_user',
    custom_metadata: null,
    created_at: '2026-10-30T00:00:00Z',
  }
}

function seed(projects: Array<{ id: string; name: string }>, reports: ReturnType<typeof report>[]): FakeDb {
  return makeFakeDb({
    projects,
    project_settings: projects.map((p) => settings(p.id)),
    reports,
    classification_evaluations: [],
    cron_runs: [],
  })
}

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: () => undefined },
    serve: (handler: (req: Request) => Promise<Response>) => {
      h.served = handler
    },
  })
  await import('../../supabase/functions/judge-batch/index.ts')
})

afterAll(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  h.logs.length = 0
  h.failed = false
  h.budgetCalls.length = 0
  h.resolveCalls.length = 0
  h.generateCalls = 0
  h.generateError = null
  h.budgetByProject = {}
  h.db = null
})

interface JudgeRunBody {
  ok: boolean
  data: { totalEvaluated: number; llmBudgetSkipped?: number }
}

function run() {
  return h.served!(new Request('https://edge.local/judge-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trigger: 'cron' }),
  }))
}

async function runJson(): Promise<{ status: number; body: JudgeRunBody }> {
  const res = await run()
  return { status: res.status, body: (await res.json()) as JudgeRunBody }
}

describe('judge-batch monthly LLM budget', () => {
  it('skips an over-budget project without a per-report failure', async () => {
    h.budgetByProject = { [P_OVER]: 'over' }
    h.db = seed([{ id: P_OVER, name: 'Over' }], [report(P_OVER, 'r-over')])

    const { status, body } = await runJson()

    expect(status).toBe(200)
    expect(body.data.llmBudgetSkipped).toBe(1)
    expect(body.data.totalEvaluated).toBe(0)
    expect(h.resolveCalls).toEqual([])
    expect(h.logs.filter((l) => l.level === 'error' && l.msg === 'Failed to evaluate report')).toEqual([])
    expect(h.logs.some((l) => l.level === 'warn' && l.msg === 'Judge skipped: monthly LLM budget reached')).toBe(true)
    expect(h.failed).toBe(false)
  })

  it('grades a project when the pre-check fails for a reason other than the budget, and still runs the next project', async () => {
    h.budgetByProject = { [P_DOWN]: 'down', [P_OK]: 'ok' }
    h.db = seed(
      [{ id: P_DOWN, name: 'Down' }, { id: P_OK, name: 'Ok' }],
      [report(P_DOWN, 'r-down'), report(P_OK, 'r-ok')],
    )

    const { status, body } = await runJson()

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(h.failed).toBe(false)
    expect(h.budgetCalls.map((c) => c.projectId)).toEqual([P_DOWN, P_OK])
    expect(h.resolveCalls).toEqual([P_DOWN, P_OK])
    expect(body.data.totalEvaluated).toBe(2)
    expect(h.logs.filter((l) => l.level === 'error' && l.msg === 'Failed to evaluate report')).toEqual([])
    expect(h.logs.filter((l) => l.level === 'fatal')).toEqual([])
    expect(h.logs.some((l) => l.level === 'warn' && l.msg === 'Judge budget pre-check failed; grading this project anyway')).toBe(true)
    expect(h.db!.table('classification_evaluations').map((row) => row.project_id).sort()).toEqual([P_DOWN, P_OK])
  })

  it('skips the remaining reports when the model call hits the monthly budget', async () => {
    h.generateError = new LlmBudgetExceededError(P_OK, 50.02, 50, '2026-11-01T00:00:00.000Z')
    const reports = Array.from({ length: 7 }, (_, i) => report(P_OK, `r-mid-${i}`))
    h.db = seed([{ id: P_OK, name: 'Ok' }], reports)

    const { status, body } = await runJson()

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.data.totalEvaluated).toBe(0)
    expect(body.data.llmBudgetSkipped).toBe(reports.length)
    expect(h.generateCalls).toBeGreaterThan(0)
    expect(h.generateCalls).toBeLessThan(reports.length)
    expect(h.logs.filter((l) => l.level === 'error' && l.msg === 'Failed to evaluate report')).toEqual([])
    expect(h.logs.some((l) => l.level === 'warn' && l.msg === 'Judge skipped: monthly LLM budget reached')).toBe(true)
    expect(h.failed).toBe(false)
    expect(h.db!.table('classification_evaluations')).toEqual([])
  })
})

/**
 * `let budgetHit: LlmBudgetExceededError | null = null` stays narrowed to
 * null across `mapWithConcurrency`, so the read after the loop is `never`.
 * This compiles that declaration and that read from the handler source.
 */
function budgetHitDiagnostics(declaration: string, ifBlock: string): string[] {
  const snippet = `
class LlmBudgetExceededError extends Error {
  spendUsd = 0
  budgetUsd = 0
}
declare function mapWithConcurrency(items: unknown[], limit: number, worker: (item: unknown) => Promise<void>): Promise<void>
declare const reports: unknown[]
declare let llmBudgetSkipped: number
declare const rootLog: { child(name: string): { warn(msg: string, fields: object): void } }
declare const project: { id: string }
export async function run(): Promise<void> {
  ${declaration}
  await mapWithConcurrency(reports, 5, async () => {
    if (budgetHit) {
      llmBudgetSkipped++
      return
    }
    budgetHit = new LlmBudgetExceededError()
  })
  ${ifBlock}
}
`
  const fileName = resolve(process.cwd(), 'budget-hit-check.ts')
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    skipLibCheck: true,
  }
  const host = ts.createCompilerHost(options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (fn, languageVersion, onError, shouldCreate) => {
    if (fn === fileName) return ts.createSourceFile(fn, snippet, languageVersion, true, ts.ScriptKind.TS)
    return getSourceFile(fn, languageVersion, onError, shouldCreate)
  }
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (fn) => fn === fileName || fileExists(fn)
  const program = ts.createProgram([fileName], options, host)
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === fileName)
    .map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`)
}

describe('judge-batch budgetHit type', () => {
  it('stays the budget error after the concurrent loop', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/functions/judge-batch/index.ts'), 'utf8')
    const declaration = src.match(/let budgetHit\b[^\n]*/)?.[0]
    expect(declaration, 'budgetHit declaration').toBeTruthy()
    const ifAt = src.lastIndexOf('if (budgetHit)')
    expect(ifAt).toBeGreaterThan(-1)
    const ifBlock = src.slice(ifAt, src.indexOf('\n      }', ifAt) + '\n      }'.length)
    expect(ifBlock).toContain('budgetHit.spendUsd')
    expect(budgetHitDiagnostics(declaration!, ifBlock)).toEqual([])
  })
})
