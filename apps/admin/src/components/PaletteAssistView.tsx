/**
 * FILE: apps/admin/src/components/PaletteAssistView.tsx
 * PURPOSE: Inline answer panel inside Cmd+K for navigate-mode Ask Mushi responses.
 */

import { useEffect, useState } from 'react'
import { Streamdown } from 'streamdown'
import type { NavStep, NavTarget } from '../lib/askMushiTypes'
import { submitAssistFeedback } from '../lib/paletteAssist'
import { ClarifyChips } from './ClarifyChips'

export interface PaletteAssistViewProps {
  query: string
  loading: boolean
  error: string | null
  text: string
  steps?: NavStep[]
  navTargets?: NavTarget[]
  clarify?: { question: string; options: string[] } | null
  langfuseTraceId?: string | null
  onNavigate: (path: string) => void
  onBack: () => void
  onContinueSidebar: () => void
  onClarifySelect: (option: string) => void
}

export function PaletteAssistView({
  query,
  loading,
  error,
  text,
  steps,
  navTargets,
  clarify,
  langfuseTraceId,
  onNavigate,
  onBack,
  onContinueSidebar,
  onClarifySelect,
}: PaletteAssistViewProps) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)
  const [feedbackPending, setFeedbackPending] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  useEffect(() => {
    setFeedback(null)
    setFeedbackError(null)
    setFeedbackPending(false)
  }, [query, langfuseTraceId])

  const showFeedback =
    Boolean(langfuseTraceId) && !loading && !error && Boolean(text) && !clarify

  async function handleFeedback(helpful: boolean) {
    if (!langfuseTraceId || feedbackPending || feedback) return
    setFeedbackPending(true)
    setFeedbackError(null)
    try {
      await submitAssistFeedback(langfuseTraceId, helpful)
      setFeedback(helpful ? 'up' : 'down')
    } catch {
      setFeedbackError('Could not save feedback — try again.')
    } finally {
      setFeedbackPending(false)
    }
  }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 border-b border-edge/60 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm px-1"
        >
          ← Back
        </button>
        <span className="text-xs text-fg-muted truncate flex-1">Ask: {query}</span>
      </div>

      <div className="overflow-y-auto flex-1 min-h-0 px-3 py-3 space-y-3">
        {loading && (
          <p className="text-xs text-fg-muted animate-pulse">Thinking…</p>
        )}
        {error && (
          <p className="text-xs text-danger">{error}</p>
        )}
        {!loading && !error && text && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-fg text-xs">
            <Streamdown>{text}</Streamdown>
          </div>
        )}

        {clarify && (
          <ClarifyChips
            question={clarify.question}
            options={clarify.options}
            onPick={onClarifySelect}
          />
        )}

        {steps && steps.length > 0 && (
          <ol className="space-y-2 text-xs text-fg">
            {steps.map((step, i) => (
              <li key={i} className="flex gap-2 items-start">
                <span className="shrink-0 font-medium text-fg-muted w-5">{i + 1}.</span>
                <span className="flex-1 min-w-0">
                  {step.text}
                  {step.path && (
                    <button
                      type="button"
                      onClick={() => onNavigate(step.path!)}
                      className="ml-2 text-[var(--color-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
                    >
                      Go →
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        {navTargets && navTargets.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {navTargets.map((t) => (
              <button
                key={t.path + t.label}
                type="button"
                onClick={() => onNavigate(t.path)}
                className="inline-flex items-center gap-1 rounded-md border border-edge bg-surface-hover/60 px-2.5 py-1.5 text-xs text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus min-h-8"
                title={t.why}
              >
                {t.label}
                <span className="text-fg-faint">→</span>
              </button>
            ))}
          </div>
        )}

        {showFeedback && (
          <div
            className="flex flex-wrap items-center gap-2 pt-2 border-t border-edge/40"
            role="group"
            aria-label="Rate this answer"
          >
            <span className="text-2xs text-fg-muted">Was this helpful?</span>
            {feedback ? (
              <span className="text-2xs text-fg-muted">Thanks for the feedback.</span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={feedbackPending}
                  onClick={() => void handleFeedback(true)}
                  aria-label="Yes, helpful"
                  aria-pressed={feedback === 'up'}
                  className="inline-flex items-center justify-center min-h-8 min-w-8 rounded-sm border border-edge-subtle text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                >
                  👍
                </button>
                <button
                  type="button"
                  disabled={feedbackPending}
                  onClick={() => void handleFeedback(false)}
                  aria-label="No, not helpful"
                  aria-pressed={feedback === 'down'}
                  className="inline-flex items-center justify-center min-h-8 min-w-8 rounded-sm border border-edge-subtle text-xs hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                >
                  👎
                </button>
              </>
            )}
            {feedbackError && (
              <span className="text-2xs text-danger">{feedbackError}</span>
            )}
          </div>
        )}
      </div>

      <footer className="border-t border-edge/60 px-3 py-2 flex justify-between items-center gap-2">
        <button
          type="button"
          onClick={onContinueSidebar}
          className="text-2xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm"
        >
          Continue in sidebar (⌘J)
        </button>
      </footer>
    </div>
  )
}
