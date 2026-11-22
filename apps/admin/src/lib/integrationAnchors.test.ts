/**
 * Links across the console still point at the old Integrations card anchors.
 * Each must open the drawer that now holds that card (owner, 2026-11-18).
 */
import { describe, expect, it } from 'vitest'
import { integrationToolForHash } from './integrationAnchors'

describe('integrationToolForHash', () => {
  it.each([
    // Every anchor other pages link to (grep of apps/admin/src, 2026-11-18).
    ['#platform-card-github', 'github'],
    ['#connect-github', 'github'],
    ['#integrations-codebase', 'github'],
    ['#platform-card-sentry', 'sentry'],
    ['#platform-card-cursor_cloud', 'cursor_cloud'],
    ['#platform-card-claude_code_agent', 'claude_code_agent'],
    ['#integrations-linear', 'linear'],
    ['#integrations-slack', 'slack'],
    ['#integrations-discord', 'discord'],
    ['#integrations-teams', 'teams'],
    ['#platform-card-langfuse', 'langfuse'],
    ['integrations-jira', 'jira'],
    ['#integrations-github_issues', 'github_issues'],
    ['#integrations-pagerduty', 'pagerduty'],
  ])('%s opens %s', (hash, tool) => {
    expect(integrationToolForHash(hash)).toBe(tool)
  })

  it('leaves page sections and unknown anchors to the scroll', () => {
    expect(integrationToolForHash('#alerts')).toBeNull()
    expect(integrationToolForHash('#integrations-routing')).toBeNull()
    expect(integrationToolForHash('#toString')).toBeNull()
    expect(integrationToolForHash('')).toBeNull()
    expect(integrationToolForHash(null)).toBeNull()
    expect(integrationToolForHash('#%E0%A4%A')).toBeNull()
  })
})
