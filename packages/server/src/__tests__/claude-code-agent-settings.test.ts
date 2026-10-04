/**
 * FILE: packages/server/src/__tests__/claude-code-agent-settings.test.ts
 * PURPOSE: Claude Code Agent card settings are saved, validated and used.
 *
 * Why (2026-10-04, QA entries 35 and 148): the card renders Default model,
 * Workflow event and Base branch, but the PUT allow-list only had the key, so
 * they were dropped (or the save failed with NO_FIELDS). The saved event now
 * drives the YAML the console hands out, so it must be a plain identifier.
 * The secrets list also told hosted users to copy a service-role key "from
 * Mushi Integrations", which the console never shows and they must not hold.
 */
import { describe, expect, it } from 'vitest'
import { validatePlatformBody } from '../../supabase/functions/_shared/integration-validation.ts'
import {
  DEFAULT_CLAUDE_WORKFLOW_EVENT,
  getMushiClaudeFixWorkflowYaml,
  MUSHI_CLAUDE_GITHUB_SECRETS,
} from '../../supabase/functions/_shared/mushi-claude-workflow.ts'

describe('Claude Code Agent settings validation', () => {
  it('accepts plain identifiers', () => {
    expect(
      validatePlatformBody({
        claude_workflow_event: 'my_event',
        claude_default_branch: 'release/2026',
        claude_default_model: 'claude-opus-4-1',
      }),
    ).toBeNull()
  })

  it('refuses values that could break or inject into the workflow YAML', () => {
    expect(validatePlatformBody({ claude_workflow_event: 'a]\n  push:' })?.code).toBe('VALIDATION_ERROR')
    expect(validatePlatformBody({ claude_default_branch: '../main' })?.code).toBe('VALIDATION_ERROR')
    expect(validatePlatformBody({ claude_default_model: 'model with spaces' })?.code).toBe('VALIDATION_ERROR')
  })

  it('lets an empty value through so it clears', () => {
    expect(validatePlatformBody({ claude_workflow_event: '' })).toBeNull()
  })
})

describe('getMushiClaudeFixWorkflowYaml', () => {
  it('listens for the saved event', () => {
    expect(getMushiClaudeFixWorkflowYaml('my_event')).toContain('types: [my_event]')
  })

  it('falls back to the default event for none or an unsafe value', () => {
    expect(getMushiClaudeFixWorkflowYaml(null)).toContain(`types: [${DEFAULT_CLAUDE_WORKFLOW_EVENT}]`)
    expect(getMushiClaudeFixWorkflowYaml('x]\n  push:')).toContain(`types: [${DEFAULT_CLAUDE_WORKFLOW_EVENT}]`)
  })
})

describe('MUSHI_CLAUDE_GITHUB_SECRETS', () => {
  it('never tells hosted users to copy a service-role key from the console', () => {
    const svc = MUSHI_CLAUDE_GITHUB_SECRETS.find((s) => s.name === 'MUSHI_SERVICE_ROLE_KEY')
    expect(svc?.description).not.toMatch(/Copy from Mushi/i)
    expect(svc?.description).toMatch(/self-hosted/i)
  })
})
