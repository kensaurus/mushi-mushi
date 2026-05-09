import { describe, it, expect } from 'vitest'
import {
  checkForSecrets,
  buildReviewPrompt,
  parseReviewResponse,
  renderSpecContext,
  validateAgainstSpec,
} from './review.js'
import type { FixContext, FixResult } from './types.js'

describe('checkForSecrets', () => {
  it('returns clean for normal code', () => {
    const result = checkForSecrets('const x = 42;\nfunction foo() {}')
    expect(result.clean).toBe(true)
    expect(result.findings).toHaveLength(0)
  })

  it('detects api_key patterns', () => {
    const result = checkForSecrets('api_key = "sk-12345"')
    expect(result.clean).toBe(false)
    expect(result.findings.length).toBeGreaterThan(0)
  })

  it('detects password patterns', () => {
    const result = checkForSecrets('password = "hunter2"')
    expect(result.clean).toBe(false)
  })

  it('detects .env references', () => {
    const result = checkForSecrets('source .env.local')
    expect(result.clean).toBe(false)
  })

  it('detects private_key patterns', () => {
    const result = checkForSecrets('private_key = "-----BEGIN"')
    expect(result.clean).toBe(false)
  })
})

describe('parseReviewResponse', () => {
  it('detects approval', () => {
    const result = parseReviewResponse('I approve this change. It looks correct.')
    expect(result.approved).toBe(true)
  })

  it('detects explicit rejection', () => {
    const result = parseReviewResponse('I reject this change. It misses edge cases.')
    expect(result.approved).toBe(false)
  })

  it('detects "do not approve"', () => {
    const result = parseReviewResponse('I do not approve this change.')
    expect(result.approved).toBe(false)
  })

  it('truncates reasoning to 500 chars', () => {
    const long = 'a'.repeat(1000)
    const result = parseReviewResponse(long)
    expect(result.reasoning.length).toBe(500)
  })
})

describe('buildReviewPrompt', () => {
  const context: FixContext = {
    reportId: 'rpt_123',
    report: {
      summary: 'Button crash on click',
      category: 'bug',
      severity: 'high',
      component: 'Button',
      rootCause: 'Null ref in handler',
      description: 'test',
    },
    reproductionSteps: ['Open page', 'Click button', 'See crash'],
  } as FixContext

  it('includes report details', () => {
    const prompt = buildReviewPrompt(context, '+ fix()')
    expect(prompt).toContain('Button crash on click')
    expect(prompt).toContain('bug')
    expect(prompt).toContain('high')
    expect(prompt).toContain('Null ref in handler')
  })

  it('includes reproduction steps', () => {
    const prompt = buildReviewPrompt(context, '')
    expect(prompt).toContain('1. Open page')
    expect(prompt).toContain('2. Click button')
    expect(prompt).toContain('3. See crash')
  })

  it('includes the diff', () => {
    const prompt = buildReviewPrompt(context, '+ const fixed = true;')
    expect(prompt).toContain('+ const fixed = true;')
  })

  it('truncates long diffs to 5000 chars', () => {
    const longDiff = 'x'.repeat(10000)
    const prompt = buildReviewPrompt(context, longDiff)
    expect(prompt.length).toBeLessThan(10000)
  })
})

describe('renderSpecContext (inventory anchor in the prompt)', () => {
  const baseCtx: FixContext = {
    reportId: 'rpt_1',
    projectId: 'prj_1',
    report: {
      description: 'd',
      category: 'bug',
      severity: 'high',
      summary: 's',
    },
    reproductionSteps: [],
    relevantCode: [],
    config: { maxLines: 200, scopeRestriction: 'component', repoUrl: 'https://github.com/x/y' },
  }

  it('returns empty string when no inventory anchor (legacy reports unchanged)', () => {
    expect(renderSpecContext(baseCtx)).toBe('')
  })

  it('renders action label, page, story, and every expected_outcome assertion', () => {
    const out = renderSpecContext({
      ...baseCtx,
      inventoryAction: {
        actionNodeId: 'node_1',
        actionLabel: 'glot-it/practice/btn-submit#button',
        actionDescription: 'submits the user\'s answer',
        pagePath: '/practice',
        pageId: 'practice',
        storyId: 'submit-answer',
        storyTitle: 'Submit answer',
        expectedOutcome: {
          summary: 'Persists an attempt and returns id',
          response: {
            status_in: [200, 201],
            json_path: [
              { path: 'data.id', op: 'exists' },
              { path: 'data.status', op: 'equals', value: 'queued' },
            ],
          },
          database: { table: 'attempts', expect: 'row_exists' },
          ui: { route_change_to: '/practice/results/:id' },
        },
      },
    })
    expect(out).toContain('Inventory Spec Context')
    expect(out).toContain('glot-it/practice/btn-submit#button')
    expect(out).toContain('submits the user\'s answer')
    expect(out).toContain('/practice')
    expect(out).toContain('Submit answer')
    expect(out).toContain('200, 201')
    expect(out).toContain('`data.id` exists')
    expect(out).toContain('`data.status` equals "queued"')
    expect(out).toContain('attempts')
    expect(out).toContain('row_exists')
    expect(out).toContain('/practice/results/:id')
  })
})

describe('buildReviewPrompt with inventory anchor', () => {
  const ctx: FixContext = {
    reportId: 'rpt_1',
    projectId: 'prj_1',
    report: {
      description: 'd',
      category: 'bug',
      severity: 'high',
      summary: 'submit button does nothing',
    },
    reproductionSteps: ['click submit'],
    relevantCode: [],
    inventoryAction: {
      actionNodeId: 'node_1',
      actionLabel: 'glot-it/practice/btn-submit#button',
      pagePath: '/practice',
      expectedOutcome: {
        response: { status_in: [200] },
      },
    },
    config: { maxLines: 200, scopeRestriction: 'component', repoUrl: 'https://github.com/x/y' },
  }

  it('includes the spec context block when an inventoryAction is set', () => {
    const prompt = buildReviewPrompt(ctx, 'diff')
    expect(prompt).toContain('Inventory Spec Context')
    expect(prompt).toContain('expected_outcome')
  })

  it('asks the reviewer to verify the contract (extra question 4)', () => {
    const prompt = buildReviewPrompt(ctx, 'diff')
    expect(prompt).toMatch(/Does the fix still satisfy every assertion/i)
  })
})

describe('validateAgainstSpec', () => {
  const baseCtx: FixContext = {
    reportId: 'rpt_1',
    projectId: 'prj_1',
    report: { description: 'd', category: 'bug', severity: 'high' },
    reproductionSteps: [],
    relevantCode: [],
    config: { maxLines: 200, scopeRestriction: 'component', repoUrl: 'https://github.com/x/y' },
  }
  const baseResult: FixResult = {
    success: true,
    branch: 'mushi/fix-1',
    filesChanged: ['apps/admin/src/pages/Practice.tsx'],
    linesChanged: 10,
    summary: 's',
  }

  it('passes through cleanly when no inventory anchor', () => {
    const r = validateAgainstSpec(baseCtx, baseResult, '+ const x = 1;')
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('warns when expected_outcome.database.table is not referenced by the diff', () => {
    const r = validateAgainstSpec(
      {
        ...baseCtx,
        inventoryAction: {
          actionNodeId: 'n',
          actionLabel: 'a',
          expectedOutcome: { database: { table: 'attempts', expect: 'row_exists' } },
        },
      },
      baseResult,
      '+ const x = 1;',
    )
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => /attempts/.test(w))).toBe(true)
  })

  it('errors hard when the diff REMOVES a json_path field the contract asserts on', () => {
    const r = validateAgainstSpec(
      {
        ...baseCtx,
        inventoryAction: {
          actionNodeId: 'n',
          actionLabel: 'a',
          expectedOutcome: {
            response: {
              json_path: [{ path: 'data.submissionId', op: 'exists' }],
            },
          },
        },
      },
      baseResult,
      [
        '--- a/api/submit.ts',
        '+++ b/api/submit.ts',
        '-  return { submissionId: id, status: "queued" }',
        '+  return { status: "queued" }',
      ].join('\n'),
    )
    expect(r.valid).toBe(false)
    expect(r.errors.some((e) => /submissionId/.test(e))).toBe(true)
  })

  it('warns when no changed file mentions the action page route', () => {
    const r = validateAgainstSpec(
      {
        ...baseCtx,
        inventoryAction: {
          actionNodeId: 'n',
          actionLabel: 'a',
          pagePath: '/checkout',
        },
      },
      { ...baseResult, filesChanged: ['apps/admin/src/pages/Settings.tsx'] },
      '+ x',
    )
    expect(r.warnings.some((w) => /checkout/.test(w))).toBe(true)
  })

  it('returns a soft warning if the agent didn\'t surface files or diff', () => {
    const r = validateAgainstSpec(
      {
        ...baseCtx,
        inventoryAction: {
          actionNodeId: 'n',
          actionLabel: 'a',
          expectedOutcome: { database: { table: 'attempts', expect: 'row_exists' } },
        },
      },
      { ...baseResult, filesChanged: [] },
    )
    expect(r.valid).toBe(true)
    expect(r.warnings.some((w) => /Spec validation skipped/.test(w))).toBe(true)
  })
})
