/**
 * Plain-language auto-fix pipeline guide.
 */

export interface FixLifecycleStageDefinition {
  id: string
  label: string
  plain: string
  clearsWhen: string
}

export const FIX_LIFECYCLE_STAGES: FixLifecycleStageDefinition[] = [
  {
    id: 'dispatch',
    label: 'Start the fix',
    plain: 'You press Dispatch fix on a bug (or Mushi Mushi does it for you). A coding agent reads your code and writes the change.',
    clearsWhen: 'Job moves from queued → running.',
  },
  {
    id: 'draft_pr',
    label: 'Proposed change',
    plain: 'The change is opened on GitHub as a pull request: a proposal you read before anything changes in your app.',
    clearsWhen: 'PR link appears on the fix row.',
  },
  {
    id: 'ci',
    label: 'Tests',
    plain: 'Your automatic tests run on the change (on GitHub, called CI). Red means it needs another try.',
    clearsWhen: 'All required checks pass.',
  },
  {
    id: 'merge',
    label: 'Merge & close',
    plain: 'Squash-merge the PR from Fixes or GitHub. Mushi marks the report Fixed and notifies the reporter.',
    clearsWhen: 'Report status → fixed.',
  },
]

export const FIXES_EXPLAINER_SUMMARY =
  'With GitHub connected, Mushi Mushi can make the change itself: it writes it, opens it as a pull request (a proposed change you review), runs your tests, and you merge it. Stopped runs stay here until you retry or copy the fix prompt into your editor.'

export function isFixesGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'no_github' ||
    topPriority === 'no_index'
  )
}
