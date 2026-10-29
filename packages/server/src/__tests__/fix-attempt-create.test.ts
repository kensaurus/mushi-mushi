/**
 * FILE: packages/server/src/__tests__/fix-attempt-create.test.ts
 * PURPOSE: POST /v1/admin/fixes stores the agent and model mushi work sends.
 */
import { describe, expect, it } from 'vitest'
import { newFixAttemptRow } from '../../supabase/functions/_shared/fix-attempt-create.ts'

const report = { id: 'r1', project_id: 'p1' }

describe('newFixAttemptRow', () => {
  it('stores local-cursor and the model, and leaves a caller with no model alone', () => {
    expect(newFixAttemptRow({ agent: 'local-cursor', llm_model: ' grok-4.7 ' }, report)).toEqual({
      report_id: 'r1',
      project_id: 'p1',
      agent: 'local-cursor',
      status: 'pending',
      llm_model: 'grok-4.7',
    })
    expect(newFixAttemptRow({ agent: 'mcp' }, report)).toEqual({
      report_id: 'r1',
      project_id: 'p1',
      agent: 'mcp',
      status: 'pending',
    })
    expect(newFixAttemptRow({ llm_model: 'm'.repeat(250) }, report).llm_model).toHaveLength(200)
    expect(newFixAttemptRow({}, report).agent).toBe('claude_code')
  })
})
