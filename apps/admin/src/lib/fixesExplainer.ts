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
    label: 'Dispatch',
    plain: 'You (or auto-triage) send a classified report to the fix agent. It clones the repo and drafts a branch.',
    clearsWhen: 'Job moves from queued → running.',
  },
  {
    id: 'draft_pr',
    label: 'Draft PR',
    plain: 'The agent opens a pull request with the proposed patch and marks it ready for review.',
    clearsWhen: 'PR link appears on the fix row.',
  },
  {
    id: 'ci',
    label: 'CI checks',
    plain: 'GitHub Actions (or your CI) runs tests on the PR. Red checks mean the patch needs another attempt.',
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
  'Fixes tracks every auto-fix attempt from dispatch through draft PR, CI, and merge. Failed runs stay visible until you retry or hand off to Cursor with fix context.'

export function isFixesGuideExpanded(topPriority: string | undefined): boolean {
  return (
    topPriority === 'no_project' ||
    topPriority === 'no_github' ||
    topPriority === 'no_index'
  )
}

export function fixLifecycleStage(id: string): FixLifecycleStageDefinition | undefined {
  return FIX_LIFECYCLE_STAGES.find((s) => s.id === id)
}
