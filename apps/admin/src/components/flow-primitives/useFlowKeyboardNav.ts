/**
 * FILE: apps/admin/src/components/flow-primitives/useFlowKeyboardNav.ts
 * PURPOSE: Power-user keyboard nav for the PDCA flow. Users can:
 *            1 / 2 / 3 / 4 → open the P / D / C / A stage drawer
 *            ← / →         → cycle focus stage
 *            Enter         → open drawer on currently focused stage
 *            Esc           → close drawer (handled by StageDrawer itself)
 *
 *          Installed at the <PdcaFlow> level; listens on the window so the
 *          shortcuts work regardless of where focus is in the diagram.
 *          Bails out when the user is typing in an input/textarea.
 */

import { useEffect } from 'react'
import { PDCA_ORDER } from '../../lib/pdca'
import type { PdcaStageId } from '../../lib/pdca'

interface Options {
  enabled?: boolean
  openStage: PdcaStageId | null
  onOpen: (stage: PdcaStageId | null) => void
}

function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

const NUMBER_TO_STAGE: Record<string, PdcaStageId> = {
  '1': 'plan',
  '2': 'do',
  '3': 'check',
  '4': 'act',
}

export function useFlowKeyboardNav({ enabled = true, openStage, onOpen }: Options) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (isTypingContext(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const stage = NUMBER_TO_STAGE[e.key]
      if (stage) {
        e.preventDefault()
        onOpen(stage)
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (!openStage) return
        const current = PDCA_ORDER.indexOf(openStage)
        if (current < 0) return
        const next = e.key === 'ArrowRight'
          ? PDCA_ORDER[(current + 1) % PDCA_ORDER.length]
          : PDCA_ORDER[(current - 1 + PDCA_ORDER.length) % PDCA_ORDER.length]
        e.preventDefault()
        onOpen(next)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled, openStage, onOpen])
}
