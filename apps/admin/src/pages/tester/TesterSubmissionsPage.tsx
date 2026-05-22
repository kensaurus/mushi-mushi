/**
 * TesterSubmissionsPage — view and manage tester's bug report submissions.
 */
import { useState } from 'react'
import { TesterLayout } from '../../components/tester/TesterLayout'
import { usePageData } from '../../lib/usePageData'
import { apiFetch } from '../../lib/supabase'
import { Btn } from '../../components/ui'

interface TesterSubmission {
  id: string
  appId: string
  appName: string
  title: string
  description: string
  status: 'pending' | 'accepted' | 'informative' | 'duplicate' | 'spam'
  pointsAwarded: number | null
  submittedAt: string
  reviewedAt: string | null
  reviewerNote: string | null
}

const STATUS_LABELS: Record<TesterSubmission['status'], { label: string; tone: string }> = {
  pending:     { label: 'Pending review', tone: 'text-fg-muted' },
  accepted:    { label: '✓ Accepted',     tone: 'text-ok' },
  informative: { label: 'Informative',   tone: 'text-brand' },
  duplicate:   { label: 'Duplicate',     tone: 'text-fg-faint' },
  spam:        { label: '✗ Spam',         tone: 'text-danger' },
}

export function TesterSubmissionsPage() {
  const { data: submissions, loading, reload } = usePageData<TesterSubmission[]>('/v1/tester/submissions')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ appId: '', title: '', description: '', screenshotUrl: '' })

  const handleSubmit = async () => {
    if (!form.appId || !form.title || !form.description) return
    setSubmitting(true)
    try {
      await apiFetch('/v1/tester/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setForm({ appId: '', title: '', description: '', screenshotUrl: '' })
      setShowForm(false)
      reload()
    } catch {
      // error handled by apiFetch toast
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <TesterLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold">My Submissions</h1>
            <p className="text-sm text-fg-muted mt-0.5">
              Track your bug reports and earned mushi-points.
            </p>
          </div>
          <Btn onClick={() => setShowForm(v => !v)}>
            {showForm ? 'Cancel' : '+ Report a bug'}
          </Btn>
        </div>

        {showForm && (
          <div className="rounded-lg border border-edge bg-surface p-4 space-y-3">
            <p className="text-sm font-medium">Submit a bug report</p>
            <div className="space-y-2">
              <input
                placeholder="App ID (from the Apps page)"
                value={form.appId}
                onChange={e => setForm(f => ({ ...f, appId: e.target.value }))}
                className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <input
                placeholder="Bug title (one-liner summary)"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <textarea
                placeholder="Steps to reproduce, expected vs actual behavior…"
                rows={4}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 resize-y"
              />
              <input
                placeholder="Screenshot URL (optional)"
                value={form.screenshotUrl}
                onChange={e => setForm(f => ({ ...f, screenshotUrl: e.target.value }))}
                className="w-full rounded-md border border-edge bg-surface-root px-3 py-2 text-sm placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </div>
            <Btn
              disabled={!form.appId || !form.title || !form.description || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Submitting…' : 'Submit bug report'}
            </Btn>
          </div>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-surface animate-pulse" />
            ))}
          </div>
        )}

        {!loading && (!submissions || submissions.length === 0) && (
          <div className="rounded-lg border border-edge bg-surface p-8 text-center">
            <p className="text-2xl mb-2">🐛</p>
            <p className="text-sm font-medium text-fg">No submissions yet</p>
            <p className="text-2xs text-fg-muted mt-1">
              Join an app and report your first bug to start earning mushi-points.
            </p>
          </div>
        )}

        {!loading && submissions && submissions.length > 0 && (
          <div className="space-y-2">
            {submissions.map((sub) => {
              const { label, tone } = STATUS_LABELS[sub.status]
              const isExpanded = expandedId === sub.id
              return (
                <div
                  key={sub.id}
                  className="rounded-lg border border-edge bg-surface overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : sub.id)}
                    className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-surface-raised motion-safe:transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{sub.title}</p>
                      <p className="text-2xs text-fg-muted mt-0.5">
                        {sub.appName} · {new Date(sub.submittedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {sub.pointsAwarded !== null && sub.pointsAwarded > 0 && (
                        <span className="text-2xs font-medium text-ok">
                          +{sub.pointsAwarded} pts
                        </span>
                      )}
                      <span className={`text-2xs font-medium ${tone}`}>{label}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-edge space-y-2">
                      <p className="text-xs text-fg-secondary whitespace-pre-wrap">{sub.description}</p>
                      {sub.reviewerNote && (
                        <div className="rounded-md bg-surface-root px-3 py-2">
                          <p className="text-2xs text-fg-muted">
                            <span className="font-medium text-fg">Reviewer note:</span> {sub.reviewerNote}
                          </p>
                        </div>
                      )}
                      {sub.reviewedAt && (
                        <p className="text-2xs text-fg-faint">
                          Reviewed {new Date(sub.reviewedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </TesterLayout>
  )
}
