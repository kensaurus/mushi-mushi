/**
 * Plain-language Skill Pipelines guide — handoff vs cloud, catalog, sources.
 */

export interface SkillModeDefinition {
  id: 'handoff' | 'cloud'
  label: string
  plain: string
  bestFor: string
  requires: string
}

export const SKILL_MODE_DEFINITIONS: SkillModeDefinition[] = [
  {
    id: 'handoff',
    label: 'Handoff mode',
    plain: 'Mushi composes a run packet — skill instructions + report context — for your local Cursor agent.',
    bestFor: 'When you want to review each step yourself in the IDE.',
    requires: 'mcp:read or mcp:write key; no Cursor Cloud API key needed.',
  },
  {
    id: 'cloud',
    label: 'Cloud mode',
    plain: 'Each pipeline step dispatches a Cursor Cloud agent run automatically.',
    bestFor: 'Hands-off workflows like audit-uiux-design-system on a report.',
    requires: 'Cursor API key in Settings + GitHub repo connected.',
  },
]

export const SKILLS_EXPLAINER_SUMMARY =
  'Skills are reusable agent workflows (from cursor-kenji or your own repos). Attach one to a bug report to get a step-by-step pipeline — browse the catalog, start a run, and check in each step as it completes.'

export type SkillsTopPriority =
  | 'no_project'
  | 'empty_catalog'
  | 'failed_runs'
  | 'awaiting_checkin'
  | 'active_runs'
  | 'healthy'
