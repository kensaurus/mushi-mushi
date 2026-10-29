/**
 * FILE: apps/admin/src/pages/FirstUserTestPage.tsx
 * PURPOSE: /first-user-test — "would a stranger get through my app?" A
 *          first-time user test (fresh-eyes runs, ADR 0053): an AI that has
 *          never seen the app tries one goal from its start page while Mushi
 *          times every step. Run now queues it for a computer of the user's
 *          (ADR 0053 amendment 2026-10-28). It used to be a tab of UX runs
 *          called "Fresh eyes", which people did not find; ?tab=fresh-eyes
 *          there redirects here.
 */

import { PageHeaderBar } from '../components/PageHeaderBar'
import { EmptyState } from '../components/ui'
import { useActiveProjectId } from '../components/ProjectSwitcher'
import { FreshEyesPanel } from '../components/ux-runs/FreshEyesPanel'
import { PAGE_CONTENT_STACK } from '../lib/pageLayout'

export function FirstUserTestPage() {
  const projectId = useActiveProjectId()
  return (
    <div className={PAGE_CONTENT_STACK}>
      <PageHeaderBar
        title="First-time user test"
        helpTitle="What is a first-time user test?"
        helpWhatIsIt="An AI that has never seen your app opens your start page and tries to do one thing, like signing up and using the main feature. It reads only what is on screen, as a new user would. Mushi times how long your app makes it wait and read, and shows where it got stuck: an error, a dead end, a sign-up it could not pass, or a step that needs an inbox, a key or a terminal."
        helpHowToUse="Check the start page and the goal, then press Run now. The test runs on your own computer (Mushi starts it there), so set up Mushi on your computer once if this page asks you to. Look around only files nothing. File what stops them turns each problem into a bug report. Open a test to see every step with its screenshot."
        helpFlowPath="/first-user-test"
      />
      {projectId ? (
        <FreshEyesPanel key={projectId} projectId={projectId} />
      ) : (
        <EmptyState title="No project selected" description="Switch to a project at the top to test it." />
      )}
    </div>
  )
}
