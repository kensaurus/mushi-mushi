/**
 * FILE: packages/agents/src/schemas.test.ts
 *
 * Round-trip tests for the hand-authored JSON Schemas exported from
 * `./schemas.ts`. Goal: catch the situation where a TS interface field
 * is added/renamed but the JSON Schema isn't updated to match.
 */

import { describe, it, expect } from 'vitest'
import {
  AGENT_JSON_SCHEMAS,
  EXPECTED_OUTCOME_JSON_SCHEMA,
  FIX_CONTEXT_JSON_SCHEMA,
  FIX_RESULT_JSON_SCHEMA,
  SANDBOX_PROVIDER_JSON_SCHEMA,
} from './schemas.js'
import type { ExpectedOutcome, FixContext, FixResult } from './types.js'

describe('Agent JSON Schemas (2026-05-09 audit)', () => {
  it('publishes draft-07 schemas with stable $ids', () => {
    expect(EXPECTED_OUTCOME_JSON_SCHEMA.$id).toBe(
      'https://kensaur.us/mushi-mushi/schemas/expected-outcome-2.0.json',
    )
    expect(FIX_CONTEXT_JSON_SCHEMA.$id).toBe(
      'https://kensaur.us/mushi-mushi/schemas/fix-context-2.0.json',
    )
    expect(FIX_RESULT_JSON_SCHEMA.$id).toBe(
      'https://kensaur.us/mushi-mushi/schemas/fix-result-2.0.json',
    )
    expect(SANDBOX_PROVIDER_JSON_SCHEMA.$id).toBe(
      'https://kensaur.us/mushi-mushi/schemas/sandbox-provider-2.0.json',
    )
  })

  it('exposes all 4 schemas by URL slug', () => {
    expect(Object.keys(AGENT_JSON_SCHEMAS).sort()).toEqual([
      'expected-outcome.json',
      'fix-context.json',
      'fix-result.json',
      'sandbox-provider.json',
    ])
  })

  // Round-trip: build a real value of the TS type and ensure every key
  // it declares is documented in the JSON Schema. This catches the
  // common drift case where a new field lands on the TS interface but
  // the published schema isn't bumped.
  it('FIX_CONTEXT_JSON_SCHEMA documents every top-level field on FixContext', () => {
    const ctx: FixContext = {
      reportId: 'rep-1',
      projectId: 'proj-1',
      report: { description: 'd', category: 'BUG', severity: 'P3' },
      reproductionSteps: ['step 1'],
      relevantCode: [{ path: 'src/x.ts', content: 'const x = 1' }],
      sentryAnalysis: undefined,
      graphContext: undefined,
      inventoryAction: {
        actionNodeId: '00000000-0000-0000-0000-000000000001',
        actionLabel: 'login form: submit',
        expectedOutcome: { summary: 'POST /login returns 200 with session cookie' },
      },
      config: { maxLines: 100, scopeRestriction: 'component', repoUrl: 'https://x' },
    }
    const docKeys = Object.keys(FIX_CONTEXT_JSON_SCHEMA.properties)
    for (const k of Object.keys(ctx)) {
      expect(docKeys, `JSON Schema is missing FixContext.${k}`).toContain(k)
    }
  })

  it('FIX_RESULT_JSON_SCHEMA documents every top-level field on FixResult', () => {
    const r: FixResult = {
      success: true,
      branch: 'fix/x',
      filesChanged: ['src/x.ts'],
      linesChanged: 5,
      summary: 'fixed it',
    }
    const docKeys = Object.keys(FIX_RESULT_JSON_SCHEMA.properties)
    for (const k of Object.keys(r)) {
      expect(docKeys, `JSON Schema is missing FixResult.${k}`).toContain(k)
    }
  })

  it('EXPECTED_OUTCOME_JSON_SCHEMA documents every top-level field on ExpectedOutcome', () => {
    const eo: ExpectedOutcome = {
      summary: 's',
      response: { status_in: [200] },
      database: { table: 't' },
      ui: { visible_text: 'ok' },
      extensions: {},
    }
    const docKeys = Object.keys(EXPECTED_OUTCOME_JSON_SCHEMA.properties)
    for (const k of Object.keys(eo)) {
      expect(docKeys, `JSON Schema is missing ExpectedOutcome.${k}`).toContain(k)
    }
  })

  it('SANDBOX_PROVIDER_JSON_SCHEMA does NOT pin the name to a closed enum', () => {
    // The whole point of opening the union is that third parties can
    // register their own provider id. If someone ever re-pins this to
    // an `enum` we want the suite to scream.
    const nameProp = SANDBOX_PROVIDER_JSON_SCHEMA.properties.name as Record<string, unknown>
    expect(nameProp.type).toBe('string')
    expect(nameProp.enum).toBeUndefined()
    expect((nameProp.examples as string[])).toContain('e2b')
  })
})
