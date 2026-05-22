/**
 * FILE: apps/admin/src/components/FeedbackModal.tsx
 * PURPOSE: In-app feedback form — Bug report and Feature request — that
 *          submits to POST /v1/support/contact (JWT auth, rate-limited at
 *          5/hour server-side). Replaces the unreliable mailto: link in
 *          BetaBanner so reports actually arrive even when the user's mail
 *          client isn't configured.
 *
 *  UX notes:
 *   - Two tabs (Bug / Feature) share a single form shell; switching tabs
 *     wipes the subject/body fields to avoid accidental mixing.
 *   - Feature request tab uses incentive language ("your idea shapes the
 *     roadmap") to overcome the activation energy of writing something.
 *   - Character counter on the body prevents the 5000-char server limit
 *     from being a surprise.
 *   - Success state auto-closes after 2.5 s to avoid the user having to
 *     click Close after a successful submit.
 *   - Fallback to mailto: is kept for the rate-limit edge-case so users
 *     always have an escape hatch.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Btn, Card } from './ui'
import { apiFetch } from '../lib/supabase'
import { useActiveProjectId } from './ProjectSwitcher'

type FeedbackType = 'bug' | 'feature'

interface FeedbackModalProps {
  onClose: () => void
  /** Pre-select the tab on open. Defaults to 'bug'. */
  initialType?: FeedbackType
  /** Called after a successful submit (before auto-close). */
  onSubmitted?: (ticketId: string) => void
}

const FALLBACK_EMAIL = 'kensaurus@gmail.com'
const MAX_BODY = 5000
const MAX_SUBJECT = 200

/** Page path + query for support triage. Excludes fragment (#…) which may carry sensitive tokens. */
function feedbackPageContext(): string {
  if (typeof window === 'undefined') return 'Page: (unknown)'
  return `Page: ${window.location.pathname}${window.location.search}`
}

const TYPE_CONFIG: Record<FeedbackType, {
  label: string
  emoji: string
  subjectPlaceholder: string
  bodyPlaceholder: string
  incentive: string
  ctaLabel: string
  successHeadline: string
  successBody: string
}> = {
  bug: {
    label: 'Report a bug',
    emoji: '🐛',
    subjectPlaceholder: 'e.g. "Clicking Save does nothing on Settings"',
    bodyPlaceholder: 'Optional — a sentence is plenty.\n\nWhat happened? Which page / browser / OS?',
    incentive: 'Takes 30 seconds. Reaches us directly — no email client needed.',
    ctaLabel: 'Send report',
    successHeadline: 'Bug report received!',
    successBody: "We read every one. You'll hear back at your account email if we need more info.",
  },
  feature: {
    label: 'Request a feature',
    emoji: '✨',
    subjectPlaceholder: 'e.g. "Export reports to CSV" or "Dark mode"',
    bodyPlaceholder: 'Optional — a sentence is plenty.\n\nWhat problem would this solve?',
    incentive: 'Every idea reaches the roadmap directly. Takes 30 seconds.',
    ctaLabel: 'Submit idea',
    successHeadline: 'Idea received!',
    successBody: "Thank you — your request is in the roadmap inbox. We ship what users actually ask for.",
  },
}

export function FeedbackModal({ onClose, initialType = 'bug', onSubmitted }: FeedbackModalProps) {
  const activeProjectId = useActiveProjectId()
  const [type, setType] = useState<FeedbackType>(initialType)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedTicketId, setSubmittedTicketId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const subjectRef = useRef<HTMLInputElement>(null)

  const config = TYPE_CONFIG[type]

  // Focus subject input on open and whenever tab changes
  useEffect(() => {
    subjectRef.current?.focus()
  }, [type])

  // Auto-close 2.5 s after successful submit
  useEffect(() => {
    if (!submitted) return
    const t = setTimeout(onClose, 2500)
    return () => clearTimeout(t)
  }, [submitted, onClose])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onClose])

  function switchType(next: FeedbackType) {
    if (next === type) return
    setType(next)
    setSubject('')
    setBody('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanSubject = subject.trim()
    const cleanBody = body.trim()

    if (cleanSubject.length < 3) { setError('Please add a short title (at least 3 characters).'); return }
    // Body is optional — page context is always appended automatically.

    setError(null)
    setSubmitting(true)

    const pageCtx = feedbackPageContext()
    const bodyWithContext = cleanBody
      ? `[${type === 'bug' ? 'Bug' : 'Feature Request'}]\n\n${cleanBody}\n\n---\n${pageCtx}`
      : `[${type === 'bug' ? 'Bug' : 'Feature Request'}]\n\n(no description provided)\n\n---\n${pageCtx}`

    const result = await apiFetch<{ ticket_id: string; created_at: string }>('/v1/support/contact', {
      method: 'POST',
      body: JSON.stringify({
        project_id: activeProjectId ?? null,
        subject: cleanSubject,
        body: bodyWithContext,
        category: type === 'bug' ? 'bug' : 'feature',
      }),
    })

    setSubmitting(false)

    if (!result.ok) {
      const err = result.error as { code?: string; message?: string }
      if (err?.code === 'RATE_LIMITED') {
        setError(`You've sent a lot of feedback recently! Email ${FALLBACK_EMAIL} for urgent issues.`)
      } else if (err?.code === 'EMAIL_REQUIRED') {
        // User session doesn't have an email — fall back to mailto
        openFallbackMailto()
        onClose()
      } else {
        setError(err?.message ?? 'Something went wrong. Please try again or email kensaurus@gmail.com.')
      }
      return
    }

    const ticketId = result.data?.ticket_id ?? null
    setSubmittedTicketId(ticketId)
    if (ticketId) onSubmitted?.(ticketId)
    setSubmitted(true)
  }

  function openFallbackMailto() {
    const mailSubject = `[mushi-mushi ${type}] ${subject}`
    const mailBody = `${body}\n\n${feedbackPageContext()}`
    const href = `mailto:${FALLBACK_EMAIL}?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`
    window.open(href, '_blank')
  }

  const bodyLen = body.length
  const bodyNearLimit = bodyLen > MAX_BODY * 0.85

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={config.label}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-overlay backdrop-blur-sm p-3 motion-safe:animate-mushi-fade-in"
      onClick={onClose}
    >
      <Card
        elevated
        className="w-full max-w-lg p-0 overflow-hidden motion-safe:animate-mushi-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-edge-subtle">
          <div className="flex items-center gap-2">
            <span className="text-base" aria-hidden>{config.emoji}</span>
            <h2 className="text-sm font-semibold text-fg">{submitted ? (type === 'bug' ? '🎉 ' : '🙌 ') + config.successHeadline : config.label}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-fg-muted hover:text-fg text-lg leading-none w-6 h-6 flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          >
            ×
          </button>
        </div>

        {submitted ? (
          /* Success state */
          <div className="px-4 py-6 text-center space-y-2">
            <p className="text-xs text-fg-secondary leading-relaxed max-w-xs mx-auto">{config.successBody}</p>
            <p className="text-2xs text-fg-muted">
              Track status anytime on{' '}
              <Link to="/feedback" className="text-brand hover:text-brand-hover font-medium" onClick={onClose}>
                My feedback
              </Link>
              .
            </p>
            {submittedTicketId && (
              <p className="text-3xs text-fg-faint font-mono">#{submittedTicketId.slice(0, 8)}</p>
            )}
            <p className="text-2xs text-fg-muted">Closing in a moment…</p>
            <div className="pt-2 flex justify-center gap-2">
              <Link
                to={submittedTicketId ? `/feedback?ticket=${submittedTicketId}` : '/feedback'}
                onClick={onClose}
              >
                <Btn size="sm" variant="ghost">View my submissions</Btn>
              </Link>
              <Btn size="sm" variant="ghost" onClick={onClose}>Close now</Btn>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-0">
            {/* Tab strip */}
            <div className="flex border-b border-edge-subtle px-4 pt-2 gap-0.5">
              {(['bug', 'feature'] as FeedbackType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchType(t)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-sm -mb-px border-b-2 transition-colors ${
                    type === t
                      ? 'border-brand text-brand'
                      : 'border-transparent text-fg-muted hover:text-fg'
                  }`}
                >
                  {t === 'bug' ? '🐛 Report a bug' : '✨ Request a feature'}
                </button>
              ))}
            </div>

            <div className="px-4 py-4 space-y-3">
              {/* Incentive line */}
              <p className="text-2xs text-fg-muted leading-snug">{config.incentive}</p>

              {/* Subject */}
              <div className="space-y-1">
                <label htmlFor="feedback-subject" className="text-xs font-medium text-fg">
                  {type === 'bug' ? 'What went wrong?' : 'What would you like?'}
                </label>
                <input
                  ref={subjectRef}
                  id="feedback-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value.slice(0, MAX_SUBJECT))}
                  placeholder={config.subjectPlaceholder}
                  className="w-full rounded-sm border border-edge bg-surface-raised px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  maxLength={MAX_SUBJECT}
                  required
                />
              </div>

              {/* Body — optional */}
              <div className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <label htmlFor="feedback-body" className="text-xs font-medium text-fg">
                    {type === 'bug' ? 'More details' : 'Tell us more'}
                    <span className="ml-1 text-2xs font-normal text-fg-faint">(optional)</span>
                  </label>
                  <span className="text-2xs text-fg-faint tabular-nums shrink-0">
                    {feedbackPageContext()} ↗ captured
                  </span>
                </div>
                <textarea
                  id="feedback-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                  placeholder={config.bodyPlaceholder}
                  rows={4}
                  className="w-full rounded-sm border border-edge bg-surface-raised px-2.5 py-1.5 text-xs text-fg placeholder:text-fg-faint focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand resize-y leading-relaxed"
                  maxLength={MAX_BODY}
                />
                {bodyNearLimit && (
                  <p className={`text-3xs text-right ${bodyLen >= MAX_BODY ? 'text-danger' : 'text-warn'}`}>
                    {bodyLen} / {MAX_BODY}
                  </p>
                )}
              </div>

              {/* Error */}
              {error && (
                <p role="alert" className="text-2xs text-danger bg-danger-muted/20 border border-danger/20 rounded-sm px-2 py-1.5 leading-snug">
                  {error}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-1 gap-2">
                <a
                  href={`mailto:${FALLBACK_EMAIL}?subject=${encodeURIComponent('[mushi-mushi] ')}`}
                  className="text-2xs text-fg-faint hover:text-fg-muted transition-colors"
                  target="_blank"
                  rel="noreferrer"
                >
                  or email us directly
                </a>
                <div className="flex gap-1.5">
                  <Btn type="button" variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                    Cancel
                  </Btn>
                  <Btn type="submit" size="sm" loading={submitting}>
                    {config.ctaLabel}
                  </Btn>
                </div>
              </div>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}
