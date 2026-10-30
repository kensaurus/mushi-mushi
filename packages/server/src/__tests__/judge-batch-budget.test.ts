/**
 * FILE: judge-batch-budget.test.ts
 * PURPOSE: The judge cron's monthly-budget pre-check skips an over-budget
 *          project without a per-report error, and any other pre-check
 *          failure stays inside that project so the rest of the cron runs.
 *
 * The source-text pin in judge-eligibility.test.ts matches the catch clause
 * even when the handler still logs `Failed to evaluate report` or never
 * skips. These tests call the handler.
 */

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
  claudeGenerateObject: async () => ({
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
  }),
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
})
