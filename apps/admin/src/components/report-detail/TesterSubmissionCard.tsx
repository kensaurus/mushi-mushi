/**
 * TesterSubmissionCard — reviewer UI for Mushi Bounties tester submissions.
 * Displayed on ReportDetailPage when report.tester_submission_id is set.
 * Lets the reviewer accept / mark informative / duplicate / spam a submission.
 */
import { useState } from 'react'
import { apiFetch } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Btn } from '../ui'
import { ContainedBlock, SignalChip, InlineProof } from './ReportSurface'

interface TesterSub {
  id: string
  status: 'pending' | 'accepted' | 'informative' | 'duplicate' | 'spam'
  points_awarded: number
  tester_handle: string | null
  app_name: string | null
  reviewer_note: string | null
}

interface Props {
  submission: TesterSub
  onReviewed: () => void
}

const STATUS_CONFIG = {
  pending:     { label: 'Pending review', tone: 'neutral' as const },
  accepted:    { label: '✓ Accepted',     tone: 'ok' as const },
  informative: { label: 'Informative',   tone: 'info' as const },
  duplicate:   { label: 'Duplicate',     tone: 'neutral' as const },
  spam:        { label: '✗ Spam',         tone: 'danger' as const },
}

type ReviewAction = 'accept' | 'informative' | 'duplicate' | 'spam'

const ACTIONS: Array<{ action: ReviewAction; label: string; variant: 'primary' | 'success' | 'ghost' | 'danger'; description: string }> = [
  { action: 'accept',      label: '✓ Accept',      variant: 'primary',   description: 'Full bounty awarded, +7 rep' },
  { action: 'informative', label: 'Informative',   variant: 'ghost',     description: '50% bounty, +0 rep' },
  { action: 'duplicate',   label: 'Duplicate',     variant: 'ghost',     description: 'No points, +2 rep' },
  { action: 'spam',        label: '✗ Spam',         variant: 'danger',    description: 'No points, −10 rep' },
]

const REVIEW_SUCCESS_LABEL: Record<ReviewAction, string> = {
  accept: 'accepted',
  informative: 'marked informative',
  duplicate: 'marked duplicate',
  spam: 'marked as spam',
}

export function TesterSubmissionCard({ submission, onReviewed }: Props) {
  const toast = useToast()
  const [reviewing, setReviewing] = useState<ReviewAction | null>(null)
  const [note, setNote] = useState(submission.reviewer_note ?? '')
  const [showNoteInput, setShowNoteInput] = useState(false)
  const config = STATUS_CONFIG[submission.status]
  const isPending = submission.status === 'pending'

  const handleReview = async (action: ReviewAction) => {
    setReviewing(action)
    try {
      await apiFetch(`/v1/admin/tester-submissions/${submission.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note || undefined }),
      })
      toast.success(`Submission ${REVIEW_SUCCESS_LABEL[action]}`)
      onReviewed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Review action failed')
    } finally {
      setReviewing(null)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
          🪲 Mushi Bounties Submission
        </h3>
        <SignalChip tone={config.tone}>{config.label}</SignalChip>
      </div>

      <ContainedBlock tone="muted" className="space-y-2">
        {submission.tester_handle && (
          <div className="flex items-center gap-2">
            <InlineProof>Tester</InlineProof>
            <span className="text-xs font-medium">{submission.tester_handle}</span>
          </div>
        )}
        {submission.app_name && (
          <div className="flex items-center gap-2">
            <InlineProof>App</InlineProof>
            <span className="text-xs font-medium">{submission.app_name}</span>
          </div>
        )}
        {submission.status !== 'pending' && (
          <div className="flex items-center gap-2">
            <InlineProof>Points</InlineProof>
            <span className="text-xs font-medium">
              {submission.points_awarded.toLocaleString()} mushi-points
            </span>
          </div>
        )}
        {submission.reviewer_note && (
          <div>
            <InlineProof>Reviewer note</InlineProof>
            <p className="text-xs text-fg-secondary mt-0.5">{submission.reviewer_note}</p>
          </div>
        )}
      </ContainedBlock>

      {isPending && (
        <div className="space-y-2">
          <p className="text-2xs text-fg-muted">
            Grade this submission. Points and reputation are credited immediately.
          </p>

          {showNoteInput && (
            <textarea
              placeholder="Optional note to the tester…"
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-xs placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
            />
          )}

          <div className="flex flex-wrap gap-2">
            {ACTIONS.map(({ action, label, variant, description }) => (
              <Btn
                key={action}
                size="sm"
                variant={variant}
                disabled={!!reviewing}
                onClick={() => handleReview(action)}
                title={description}
              >
                {reviewing === action ? '…' : label}
              </Btn>
            ))}
            <button
              type="button"
              className="text-2xs text-fg-faint hover:text-fg-muted motion-safe:transition-colors"
              onClick={() => setShowNoteInput(v => !v)}
            >
              {showNoteInput ? 'Hide note' : 'Add note'}
            </button>
          </div>

          <p className="text-2xs text-fg-faint">
            Accept = full bounty + 7 rep · Informative = 50% + 0 rep · Duplicate = 0 + 2 rep · Spam = 0 − 10 rep
          </p>
        </div>
      )}
    </section>
  )
}
