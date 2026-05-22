/**
 * FILE: apps/admin/src/components/settings/DevToolsPanel.tsx
 * PURPOSE: Local-only knobs that don't touch the backend — debug logging, etc.
 *          Draft locally; Save persists to localStorage without a full-page reload.
 */

import { useState } from 'react'
import { Section, Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import { isDebugEnabled, setDebugEnabled } from '../../lib/debug'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { SettingsPanelLayout } from './SettingsPanelLayout'
import { valuesEqual } from './settingsDiff'
import { ContainedBlock } from '../report-detail/ReportSurface'

export function DevToolsPanel() {
  const toast = useToast()
  const [savedDebug, setSavedDebug] = useState<boolean>(() => isDebugEnabled())
  const [debug, setDebug] = useState<boolean>(() => isDebugEnabled())
  const dirty = !valuesEqual(debug, savedDebug)

  function apply() {
    setDebugEnabled(debug)
    setSavedDebug(debug)
    toast.success(
      debug ? 'Debug mode on' : 'Debug mode off',
      debug
        ? 'API calls, auth events, and timings will now log to the browser console.'
        : 'Diagnostic logs are no longer printed to the console.',
    )
  }

  function reset() {
    setDebug(savedDebug)
  }

  return (
    <SettingsPanelLayout
      fullWidth={
        <ContainedBlock tone="muted">
          <p className="text-2xs leading-relaxed text-fg-muted">
            Local-only debug flags — saved to this browser via Apply. API calls, auth events, and timings
            log to the console when debug mode is on.
          </p>
        </ContainedBlock>
      }
      footer={
        <SettingsFormFooter
          dirty={dirty}
          changeCount={dirty ? 1 : 0}
          onSave={apply}
          onDiscard={reset}
          saveLabel="Apply"
        />
      }
    >
      <Section title="Developer Tools">
        <Toggle
          label="Debug mode — log all API calls, auth events, and timings to browser console"
          helpId="settings.devtools.debug_mode"
          checked={debug}
          onChange={setDebug}
        />
        <SettingsChangeHint current={debug} saved={savedDebug} kind="bool" />
      </Section>
    </SettingsPanelLayout>
  )
}
