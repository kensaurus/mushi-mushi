/**
 * FILE: apps/admin/src/components/onboarding/OnboardingModeIntroCard.tsx
 * PURPOSE: Surfaces the mode picker prominently on first visit to /onboarding
 *          with a 1-sentence explainer per mode. Renders above the tab bar.
 *
 * Dismissed via localStorage key 'mushi:mode-intro-seen' so it only shows
 * on the very first visit. Reopenable via the "Change mode" link in the sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAdminMode, type AdminMode } from '../../lib/mode'
import { SegmentedControl } from '../ui'

const MODE_INFO: Record<AdminMode, { label: string; tagline: string }> = {
  quickstart: {
    label: 'Quick',
    tagline: 'Three steps. Advanced pages stay hidden until you need them.',
  },
  beginner: {
    label: 'Step-by-step',
    tagline: 'All the options, with tooltips on every term you have not seen before.',
  },
  advanced: {
    label: 'Power user',
    tagline: 'Full console with dense tables and no hand-holding.',
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

  const options = useMemo(
    () =>
      (Object.entries(MODE_INFO) as [AdminMode, typeof MODE_INFO[AdminMode]][]).map(
        ([id, info]) => ({ id, label: info.label }),
      ),
    [],
  )

  const handleModeChange = useCallback(
    (next: AdminMode) => {
      setMode(next)
      dismiss()
    },
    [setMode, dismiss],
  )

  if (!visible) return null

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-brand">
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
          Dismiss
        </button>
      </div>

      <div className="mt-3 space-y-2">
        <SegmentedControl
          value={mode}
          options={options}
          onChange={handleModeChange}
          ariaLabel="Admin console mode"
          size="md"
          wrap
          className="w-full sm:w-auto"
        />
        <p className="text-2xs leading-relaxed text-fg-muted">
          {MODE_INFO[mode].tagline}
        </p>
      </div>
    </div>
  )
}
