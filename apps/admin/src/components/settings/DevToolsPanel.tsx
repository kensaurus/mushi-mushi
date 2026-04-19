/**
 * FILE: apps/admin/src/components/settings/DevToolsPanel.tsx
 * PURPOSE: Local-only knobs that don't touch the backend — debug logging, etc.
 *          Toggling persists to localStorage and reloads to take effect cleanly.
 */

import { Section, Toggle } from '../ui'
import { isDebugEnabled, setDebugEnabled } from '../../lib/debug'

export function DevToolsPanel() {
  return (
    <div className="space-y-4 max-w-2xl">
      <Section title="Developer Tools">
        <Toggle
          label="Debug mode — log all API calls, auth events, and timings to browser console"
          checked={isDebugEnabled()}
          onChange={(v) => { setDebugEnabled(v); window.location.reload() }}
        />
      </Section>
    </div>
  )
}
