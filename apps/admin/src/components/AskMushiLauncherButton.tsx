/**
 * FILE: apps/admin/src/components/AskMushiLauncherButton.tsx
 * PURPOSE: Prominent glowing header affordance for Ask Mushi (Cmd/Ctrl+J).
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
  /** When the sidebar is open, suppress the first-run glow. */
  panelOpen?: boolean
}

function readIntroSeen(): boolean {
  return isAskMushiIntroSeen()
}

export function AskMushiLauncherButton({ onClick, panelOpen = false }: AskMushiLauncherButtonProps) {
  const introSeen = useSyncExternalStore(subscribeAskMushiIntro, readIntroSeen, readIntroSeen)
  const showGlow = !introSeen && !panelOpen

  return (
    <Tooltip
      content={showGlow ? 'Ask Mushi — your AI guide (Cmd/Ctrl+J)' : 'Ask Mushi (Cmd/Ctrl+J)'}
      side="bottom"
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
          'ask-mushi-launcher relative inline-flex items-center justify-center',
          'h-9 w-9 rounded-md',
          'text-brand bg-brand/10 border border-brand/25',
          'hover:bg-brand/15 hover:text-brand',
          'motion-safe:transition-[background-color,color,box-shadow,border-color]',
          'motion-safe:duration-[var(--duration-fast,150ms)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
          showGlow ? 'ask-mushi-launcher--glow' : '',
        ].join(' ')}
      >
        <IconChat className="h-4 w-4 relative z-[1]" aria-hidden />
        {showGlow ? (
          <span
            aria-hidden
            className="ask-mushi-launcher__ring pointer-events-none absolute inset-0 rounded-md"
          />
        ) : null}
      </button>
    </Tooltip>
  )
}
