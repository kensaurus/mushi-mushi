import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { Section, RelativeTime, InfoHint, Tooltip, Btn } from '../ui'
import { IconChat } from '../icons'
import { useReportComments, type FeedbackSignal } from '../../lib/reportComments'
import { useToast } from '../../lib/toast'
import { CHIP_TONE } from '../../lib/chipTone'

// Loop-closure: short, human-readable hover text for each feedback chip
// the SDK widget can attach to a reporter reply. Used by the comment
// thread to explain "why is this badge here?" without making the
// reviewer hunt through docs.
function feedbackSignalTooltip(signal: FeedbackSignal): string {
  switch (signal) {
    case 'confirms':
      return 'Reporter confirmed this IS the bug they meant. Strongest positive signal — feeds the judge as ground truth.'
    case 'wrong_target':
      return "Reporter says we fixed the wrong thing. Stage 1/2 mis-classified the report; the prompt-tuner pulls these as negative training examples."
    case 'agent_fixed_wrong_thing':
      return 'Reporter says the bug is real but the fix is wrong. The classifier was right; the fix-worker prompt needs improvement.'
    case 'already_fixed':
      return 'Reporter says the bug is gone — likely a regression that someone else fixed. Auto-resolves the report.'
    case 'noise':
      return "Reporter says this shouldn't have been classified — noise / spam / off-topic. Down-weights this reporter's anti-gaming score."
    case 'not_fixed':
      return 'Reporter says the fix did not work — regression reopen was filed automatically.'
    default:
      return 'Reporter feedback signal.'
  }
}

function feedbackSignalToneClass(signal: FeedbackSignal): string {
  switch (signal) {
    case 'confirms':
      return `border-ok/40 ${CHIP_TONE.okSubtle}`
    case 'already_fixed':
      return `border-info/40 ${CHIP_TONE.infoSubtle}`
    case 'wrong_target':
    case 'agent_fixed_wrong_thing':
      return `border-warn/40 ${CHIP_TONE.warnSubtle}`
    case 'noise':
      return `border-danger/40 ${CHIP_TONE.dangerSubtle}`
    case 'not_fixed':
      return `border-warn/40 ${CHIP_TONE.warnSubtle}`
    default:
      return 'border-edge-subtle bg-surface-overlay text-fg-muted'
  }
}

export function ReportComments({ reportId, projectId }: { reportId: string; projectId: string }) {
  const toast = useToast()
  const { comments, loading, postComment, deleteComment } = useReportComments({ reportId, projectId })
  const [body, setBody] = useState('')
  const [visibleToReporter, setVisibleToReporter] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await postComment(body, { visibleToReporter })
      setBody('')
      setVisibleToReporter(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again in a moment.'
      toast.error('Couldn\u2019t post comment', msg)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    setDeleting(true)
    try {
      await deleteComment(id)
      setDeleteTarget(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again in a moment.'
      toast.error('Couldn\u2019t delete comment', msg)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Section title={`Triage thread (${comments.length})`} icon={<IconChat />}>
      <div className="space-y-2 mb-3 max-h-72 overflow-y-auto">
        {loading && <div className="text-xs text-fg-muted">Loading…</div>}
        {!loading && comments.length === 0 && (
          <div className="text-xs text-fg-muted italic">No comments yet. Add the first triage note below.</div>
        )}
        {comments.map((c) => (
          <div key={c.id} className={`flex gap-2 items-start text-xs ${c.author_kind === 'reporter' ? 'rounded-md border border-accent/20 bg-accent/5 p-2' : ''}`}>
            <div className="w-6 h-6 rounded-full bg-surface-raised border border-edge text-2xs flex items-center justify-center flex-shrink-0">
              {c.author_kind === 'reporter' ? 'RP' : (c.author_name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-fg">{c.author_kind === 'reporter' ? 'Reporter' : (c.author_name ?? 'Unknown')}</span>
                {c.author_kind === 'reporter' && (
                  <span className="text-2xs text-accent border border-accent/40 px-1 rounded">reporter replied</span>
                )}
                {c.feedback_signal && (
                  <Tooltip content={feedbackSignalTooltip(c.feedback_signal)}>
                    <span
                      className={`text-2xs px-1 rounded font-mono cursor-help border ${feedbackSignalToneClass(c.feedback_signal)}`}
                    >
                      {c.feedback_signal}
                    </span>
                  </Tooltip>
                )}
                <span className="text-2xs text-fg-muted">
                  <RelativeTime value={c.created_at} />
                </span>
                {c.visible_to_reporter && (
                  <Tooltip content="Reporter can see this comment in their notifications.">
                    <span className="text-2xs text-accent border border-accent/40 px-1 rounded cursor-help">visible to reporter</span>
                  </Tooltip>
                )}
              </div>
              <div className="text-fg-secondary whitespace-pre-wrap wrap-break-word text-pretty leading-relaxed">{c.body}</div>
            </div>
            <button
              type="button"
              onClick={() => setDeleteTarget(c.id)}
              className="text-2xs text-fg-faint hover:text-danger px-1"
              aria-label="Delete comment"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setVisibleToReporter(true)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-md border border-accent/35 ${CHIP_TONE.accentSubtle} hover:bg-accent/10 motion-safe:transition-opacity`}
          >
            Message reporter
          </button>
          {visibleToReporter && (
            <span className="text-2xs text-accent">Reply will be visible in their inbox</span>
          )}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          placeholder="Add a triage note…"
          className="w-full text-xs p-2 rounded-md bg-surface-raised border border-edge resize-y min-h-16 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
          maxLength={10000}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="text-xs flex items-center gap-1.5 text-fg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={visibleToReporter}
              onChange={(e) => setVisibleToReporter(e.currentTarget.checked)}
            />
            Reply to reporter
            <InfoHint content="If checked, the reporter will receive a notification with this message in the SDK widget." />
          </label>
          <Btn type="submit" variant="accent" size="sm" loading={submitting} disabled={!body.trim()}>
            Post
          </Btn>
        </div>
      </form>

      {deleteTarget != null ? (
        <ConfirmDialog
          title="Delete this comment?"
          body="The triage note will be removed permanently. Reporter-visible replies cannot be recovered."
          confirmLabel="Delete"
          cancelLabel="Keep"
          tone="danger"
          loading={deleting}
          onConfirm={() => void handleDelete(deleteTarget)}
          onCancel={() => {
            if (!deleting) setDeleteTarget(null)
          }}
        />
      ) : null}
    </Section>
  )
}
