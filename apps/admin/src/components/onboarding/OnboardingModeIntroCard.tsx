/**
 * FILE: apps/admin/src/components/onboarding/OnboardingModeIntroCard.tsx
 * PURPOSE: Surfaces the mode picker prominently on first visit to /onboarding
 *          with a 1-sentence explainer per mode. Renders above the tab bar.
 *
 * Dismissed via localStorage key 'mushi:mode-intro-seen' so it only shows
 * on the very first visit. Reopenable via the "Change mode" link in the sidebar.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAdminMode, type AdminMode } from '../../lib/mode'

const MODE_INFO: Record<AdminMode, { emoji: string; label: string; tagline: string }> = {
  quickstart: {
    emoji: '⚡',
    label: 'Quick',
    tagline: '3 steps, plain English, hide everything you don\'t need yet.',
  },
  beginner: {
    emoji: '🐛',
    label: 'Step-by-step',
    tagline: 'All the options, with tooltips on every term you haven\'t seen before.',
  },
  advanced: {
    emoji: '🏯',
    label: 'Power user',
    tagline: 'Full console with jargon-rich labels, dense tables, and no hand-holding.',
  },
}

const SEEN_KEY = 'mushi:mode-intro-seen'

function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, 'true')
  } catch { /* ignore */ }
}

export function OnboardingModeIntroCard() {
  const { mode, setMode } = useAdminMode()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!hasSeenIntro())
  }, [])

  const dismiss = useCallback(() => {
    markSeen()
    setVisible(false)
  }, [])

  const choose = useCallback((m: AdminMode) => {
    setMode(m)
    dismiss()
  }, [setMode, dismiss])

  if (!visible) return null

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">
            How do you want to use Mushi?
          </p>
          <p className="mt-0.5 text-2xs text-fg-muted">
            Pick a mode — you can change it any time in the sidebar.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 text-xs text-fg-faint hover:text-fg"
          aria-label="Dismiss mode picker"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(Object.entries(MODE_INFO) as [AdminMode, typeof MODE_INFO[AdminMode]][]).map(([m, info]) => (
          <button
            key={m}
            type="button"
            onClick={() => choose(m)}
            className={[
              'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition',
              mode === m
                ? 'border-brand bg-brand/10'
                : 'border-edge bg-surface hover:border-brand/40',
            ].join(' ')}
          >
            <span className="text-base">{info.emoji}</span>
            <span className="text-xs font-semibold text-fg">{info.label}</span>
            <span className="text-2xs leading-relaxed text-fg-muted">{info.tagline}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
