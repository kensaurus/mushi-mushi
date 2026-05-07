/**
 * FILE: apps/admin/src/components/settings/DevToolsPanel.tsx
 * PURPOSE: Local-only knobs that don't touch the backend — debug logging, etc.
 *          Toggling persists to localStorage and updates in place — no full-page
 *          reload, so the rest of the admin (filters, scroll, drafts) stays put.
 */

import { useState } from 'react'
import { Section, Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import { isDebugEnabled, setDebugEnabled } from '../../lib/debug'

export function DevToolsPanel() {
  const toast = useToast()
  // Source of truth is localStorage (`mushi:debug`), but we mirror it into
  // React state so the toggle is instantly reactive — the previous version
  // called `window.location.reload()` to force the toggle's `checked` to
  // reflect the new localStorage value, which felt jarring (whole app
  // remounted, drafts lost, scroll snapped to top). `debugLog()` re-reads
  // localStorage on every call site, so flipping the flag takes effect
  // immediately for any code path that runs after this render.
  const [debug, setDebug] = useState<boolean>(() => isDebugEnabled())

  function handleToggle(next: boolean) {
    setDebugEnabled(next)
    setDebug(next)
    toast.success(
      next ? 'Debug mode on' : 'Debug mode off',
      next
        ? 'API calls, auth events, and timings will now log to the browser console.'
        : 'Diagnostic logs are no longer printed to the console.',
    )
  }

  return (
    // Width matches the other settings tabs (full page container) so a tab
    // switch never reflows the right edge of the page. Only one section
    // today, so the grid is single-column at every viewport — but stays a
    // grid so future toggles can be added 2-up without re-architecting.
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <Section title="Developer Tools">
          <Toggle
            label="Debug mode — log all API calls, auth events, and timings to browser console"
            helpId="settings.devtools.debug_mode"
            checked={debug}
            onChange={handleToggle}
          />
        </Section>
      </div>
    </div>
  )
}
