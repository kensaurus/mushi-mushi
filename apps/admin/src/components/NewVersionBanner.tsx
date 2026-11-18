/**
 * FILE: apps/admin/src/components/NewVersionBanner.tsx
 * PURPOSE: "New version — Reload" once a deploy's service worker is waiting
 *          (lib/swUpdate.ts). It stays until pressed, never reloads on its
 *          own (a form may be half filled), and is slim: one line, one button.
 */

import { useSyncExternalStore } from 'react'
import { Card } from './ui'
import { getSwUpdate, subscribeSwUpdate } from '../lib/swUpdate'

export function NewVersionBanner() {
  const apply = useSyncExternalStore(subscribeSwUpdate, getSwUpdate, () => null)
  if (!apply) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="new-version-banner"
      className="fixed bottom-3 left-1/2 z-(--z-alert) max-w-full -translate-x-1/2 motion-safe:animate-mushi-toast-in"
    >
      <Card className="flex items-center gap-3 px-3 py-2 text-xs text-fg">
        <span className="h-2 w-2 shrink-0 rounded-full bg-info" aria-hidden="true" />
        <span className="font-semibold">New version ready</span>
        <button
          type="button"
          onClick={() => apply()}
          className="inline-flex h-6 items-center rounded-sm bg-brand px-2.5 text-2xs font-semibold text-brand-fg hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Reload
        </button>
      </Card>
    </div>
  )
}
