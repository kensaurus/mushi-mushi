/**
 * FILE: apps/admin/src/components/AskMushiLauncherButton.tsx
 * PURPOSE: Ask Mushi launcher — matches sibling toolbar icon buttons (h-8).
 */

import { useSyncExternalStore } from 'react'
import { IconChat } from './icons'
import { Tooltip } from './ui'
import {
  isAskMushiIntroSeen,
  markAskMushiIntroSeen,
  subscribeAskMushiIntro,
} from '../lib/askMushiIntro'

interface AskMushiLauncherButtonProps {
  onClick: () => void
  panelOpen?: boolean
}

function readIntroSeen(): boolean {
  return isAskMushiIntroSeen()
}

export function AskMushiLauncherButton({ onClick, panelOpen = false }: AskMushiLauncherButtonProps) {
  const introSeen = useSyncExternalStore(subscribeAskMushiIntro, readIntroSeen, readIntroSeen)
  const showPulse = !introSeen && !panelOpen

  return (
    <Tooltip
      content={showPulse ? 'Ask Mushi — your AI guide (Cmd/Ctrl+J)' : 'Ask Mushi (Cmd/Ctrl+J)'}
      side="auto"
      nowrap={false}
    >
      <button
        type="button"
        data-tour-id="ask-mushi-launcher"
        onClick={() => {
          markAskMushiIntroSeen()
          onClick()
        }}
        aria-label="Open Ask Mushi"
        className={[
          'relative inline-flex items-center justify-center h-8 w-8 rounded-sm',
          showPulse ? 'text-brand' : 'text-fg-muted hover:text-fg hover:bg-surface-overlay',
          'motion-safe:transition-opacity',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
        ].join(' ')}
      >
        <IconChat className="h-3.5 w-3.5" aria-hidden />
        {showPulse ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse"
          />
        ) : null}
      </button>
    </Tooltip>
  )
}
