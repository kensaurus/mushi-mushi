/**
 * FILE: apps/admin/src/components/settings/DevToolsPanel.tsx
 * PURPOSE: Settings → SDK & connection → Debug logging. Options that live
 *          only in this browser and
 *          never touch the backend: debug logging. Apply saves to this
 *          browser without a reload.
 */

import { useState } from 'react'
import { Toggle } from '../ui'
import { useToast } from '../../lib/toast'
import { isDebugEnabled, setDebugEnabled } from '../../lib/debug'
import { IconTerminal } from '../icons'
import { SettingsChangeHint } from './SettingsChangeHint'
import { SettingsFormFooter } from './SettingsFormFooter'
import { valuesEqual } from './settingsDiff'
import { SettingsList, SettingsRow } from './SettingsRow'

export function DevToolsPanel() {
  const toast = useToast()
  const [savedDebug, setSavedDebug] = useState<boolean>(() => isDebugEnabled())
  const [debug, setDebug] = useState<boolean>(() => isDebugEnabled())
  const dirty = !valuesEqual(debug, savedDebug)

  function apply() {
    setDebugEnabled(debug)
    setSavedDebug(debug)
    toast.success(
      debug ? 'Debug logging on' : 'Debug logging off',
      debug
        ? 'API calls, sign-in events and timings now print to the browser console.'
        : 'Diagnostic logs no longer print to the console.',
    )
  }

  return (
    <>
      <SettingsList
        title="Debug logging (this browser)"
        description="Options for this browser only. They don't change anything for your project or your team."
      >
        <SettingsRow
          icon={<IconTerminal size={16} />}
          title="Log to the browser console"
          purpose="Prints every API call, sign-in event and timing to the browser console. Useful when reporting a console problem."
          action={
            <Toggle
              label={debug ? 'On' : 'Off'}
              ariaLabel="Debug logging"
              helpId="settings.devtools.debug_mode"
              checked={debug}
              onChange={setDebug}
            />
          }
        >
          <SettingsChangeHint current={debug} saved={savedDebug} kind="bool" />
        </SettingsRow>
      </SettingsList>
      <SettingsFormFooter
        dirty={dirty}
        changeCount={dirty ? 1 : 0}
        onSave={apply}
        onDiscard={() => setDebug(savedDebug)}
        saveLabel="Apply"
      />
    </>
  )
}
