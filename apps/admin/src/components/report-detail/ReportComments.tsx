import { useState } from 'react'
import { Section, RelativeTime, InfoHint, Tooltip } from '../ui'
import { IconChat } from '../icons'
import { useReportComments } from '../../lib/reportComments'
import { useToast } from '../../lib/toast'

export function ReportComments({ reportId, projectId }: { reportId: string; projectId: string }) {
  const toast = useToast()
  const { comments, loading, postComment, deleteComment } = useReportComments({ reportId, projectId })
  const [body, setBody] = useState('')
  const [visibleToReporter, setVisibleToReporter] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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
    try {
      await deleteComment(id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Try again in a moment.'
      toast.error('Couldn\u2019t delete comment', msg)
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
          <div key={c.id} className="flex gap-2 items-start text-xs">
            <div className="w-6 h-6 rounded-full bg-surface-raised border border-edge text-2xs flex items-center justify-center flex-shrink-0">
              {(c.author_name ?? '?').slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-medium text-fg">{c.author_name ?? 'Unknown'}</span>
                <span className="text-2xs text-fg-muted">
                  <RelativeTime value={c.created_at} />
                </span>
                {c.visible_to_reporter && (
                  <Tooltip content="Reporter can see this comment in their notifications.">
                    <span className="text-2xs text-accent border border-accent/40 px-1 rounded cursor-help">visible to reporter</span>
                  </Tooltip>
                )}
              </div>
              <div className="text-fg-secondary whitespace-pre-wrap break-words">{c.body}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleDelete(c.id)}
              className="text-2xs text-fg-faint hover:text-danger px-1"
              aria-label="Delete comment"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <form onSubmit={onSubmit} className="space-y-1.5">
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
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-md bg-accent text-fg-on-accent disabled:opacity-50 hover:bg-accent-hover motion-safe:transition-colors"
          >
            {submitting && (
              <span
                className="inline-block w-3 h-3 rounded-full border border-current/30 border-t-current motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            <span>Post</span>
          </button>
        </div>
      </form>
    </Section>
  )
}
