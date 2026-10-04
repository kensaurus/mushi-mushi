/**
 * FILE: apps/admin/src/components/recipe/RecipeChangePreview.tsx
 * PURPOSE: The dry-run diff, the "Open draft PR" confirm, and then the job as
 *          it runs (queued → running → PR opened / rejected / failed), for a
 *          recipe change from the side panel. The diff and denied-path
 *          renderers are the design plane's (DesignChangePreview).
 *          A PR link is only rendered for an https URL the server returned.
 */

import { PROJECT_ADMIN_PR_HINT, useActiveProjectCanManage } from '../../lib/useOrgCanManage'
import { actionErrorText } from '../../lib/actionErrorText'
import { Btn, Callout, ErrorAlert } from '../ui'
import { LINK_ACCENT } from '../../lib/chipTone'
import { DeniedList, FileDiffs } from '../design/DesignChangePreview'
import type { RecipeChangeJobView, RecipeChangeState } from './useRecipeChange'

function safePrUrl(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null
}

function PrLink({ url, number, children }: { url: string | null; number: number | null; children?: string }) {
  const href = safePrUrl(url)
  const label = children ?? (number ? `Draft PR #${number}` : 'the draft PR')
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_ACCENT}>
      {label}
    </a>
  ) : (
    <span className="font-mono">{label}</span>
  )
}

function JobResult({ job, onDone }: { job: RecipeChangeJobView; onDone: () => void }) {
  if (job.status === 'queued' || job.status === 'running') {
    return (
      <p className="text-xs text-fg-muted" role="status">
        {job.status === 'queued' ? 'Queued — opening the draft PR shortly…' : 'Opening the draft PR on GitHub…'}
      </p>
    )
  }
  const alreadyOpen = job.status === 'rejected' && safePrUrl(job.prUrl) !== null
  return (
    <div className="flex flex-col gap-2">
      {job.status === 'pr_opened' ? (
        <Callout tone="ok" label="Draft PR opened">
          <p className="text-xs text-fg-secondary">
            <PrLink url={job.prUrl} number={job.prNumber} />
            {job.branch ? (
              <>
                {' '}on <span className="font-mono">{job.branch}</span>
              </>
            ) : null}{' '}
            — stays in draft so your CI does not run until you mark it ready. Nothing changes until you merge.
          </p>
        </Callout>
      ) : alreadyOpen ? (
        <Callout tone="warn" label="A Mushi draft PR for this is already open">
          <p className="text-xs text-fg-secondary">
            Finish or close <PrLink url={job.prUrl} number={job.prNumber}>that draft PR</PrLink> first, then preview again. No new
            PR was opened.
          </p>
        </Callout>
      ) : (
        <Callout tone="warn" label={job.status === 'rejected' ? 'No PR was opened' : 'The change failed'}>
          <p className="text-xs text-fg-secondary wrap-break-word">{job.error ?? 'The server gave no reason.'}</p>
        </Callout>
      )}
      <div>
        <Btn size="sm" variant="ghost" onClick={onDone}>
          Done
        </Btn>
      </div>
    </div>
  )
}

interface RecipeChangePreviewProps {
  state: RecipeChangeState
  onConfirm: () => void
  onDiscard: () => void
}

export function RecipeChangePreview({ state, onConfirm, onDiscard }: RecipeChangePreviewProps) {
  const { phase, preview, job, error, note } = state
  // Opening the PR is for the project team's owners and admins; a member
  // learned that only after confirming (QA 292).
  const { canManage } = useActiveProjectCanManage()
  if (phase === 'idle') return null
  if (phase === 'previewing') {
    return (
      <p className="text-xs text-fg-muted" role="status">
        Building the preview diff…
      </p>
    )
  }
  if ((phase === 'following' || phase === 'done') && job) {
    return (
      <div className="flex flex-col gap-2">
        {note && <p className="text-xs text-fg-secondary">{note}</p>}
        <JobResult job={job} onDone={onDiscard} />
      </div>
    )
  }
  const nothing = !preview || preview.files.length === 0
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorAlert message={actionErrorText({ message: error })} />}
      {preview && (
        <>
          <p className="text-xs text-fg-secondary">
            Preview only — nothing is written yet. Confirm to open a draft PR with exactly this diff.
          </p>
          <FileDiffs files={preview.files} />
          <DeniedList denied={preview.denied} />
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              size="sm"
              variant="primary"
              onClick={onConfirm}
              loading={phase === 'submitting'}
              disabled={phase === 'submitting' || nothing || preview.denied.length > 0 || canManage === false}
              title={
                canManage === false
                  ? PROJECT_ADMIN_PR_HINT
                  : nothing
                  ? 'Nothing to open: the preview changes no file'
                  : preview.denied.length > 0
                    ? 'A file in this change is not writable; fix that first'
                    : phase === 'submitting'
                      ? 'Starting the draft PR…'
                      : 'Open a draft PR with exactly this diff'
              }
            >
              Open draft PR
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              onClick={onDiscard}
              disabled={phase === 'submitting'}
              title={phase === 'submitting' ? 'Wait for the request to finish' : 'Throw away this preview'}
            >
              Discard preview
            </Btn>
          </div>
          {canManage === false && <p className="text-xs text-fg-muted">{PROJECT_ADMIN_PR_HINT}</p>}
        </>
      )}
      {!preview && phase === 'error' && (
        <div>
          <Btn size="sm" variant="ghost" onClick={onDiscard}>
            Dismiss
          </Btn>
        </div>
      )}
    </div>
  )
}
