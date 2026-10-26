/**
 * FILE: apps/admin/src/components/settings/LabsPanel.tsx
 * PURPOSE: Settings › Labs. One switch per page outside the core
 *          bug → diagnosis → fix loop (lib/labs.ts), grouped the way the
 *          registry groups them. On adds the page to the sidebar; off only
 *          hides it there — every page stays reachable from ⌘K and by link.
 *          Saved to your account as you switch (lib/labs.ts), so there is no
 *          Save and other browsers get the same pages.
 */

import { Btn, Toggle } from '../ui'
import { LAB_FEATURES, LAB_GROUP_LABEL, useLabs, type LabFeature } from '../../lib/labs'
import { SettingsList, SettingsRow } from './SettingsRow'

const GROUPS = Object.keys(LAB_GROUP_LABEL) as LabFeature['group'][]

export function LabsPanel() {
  const { isEnabled, setEnabled } = useLabs()

  return (
    <div className="space-y-4" data-testid="settings-labs">
      <p className="text-sm text-fg-muted">
        Labs are pages outside the core bug → diagnosis → fix loop. Switch one on to add it to your
        sidebar. Every page stays reachable from ⌘K and by link.
      </p>
      {GROUPS.map((group) => {
        const features = LAB_FEATURES.filter((f) => f.group === group)
        if (features.length === 0) return null
        return (
          <SettingsList key={group} title={LAB_GROUP_LABEL[group]}>
            {features.map((f) => {
              const on = isEnabled(f.id)
              return (
                <SettingsRow
                  key={f.id}
                  id={`lab-${f.id}`}
                  title={f.label}
                  purpose={f.description}
                  action={
                    <>
                      <Toggle
                        ariaLabel={f.label}
                        label={on ? 'On' : 'Off'}
                        checked={on}
                        onChange={(next) => setEnabled(f.id, next)}
                      />
                      <Btn
                        size="sm"
                        variant="ghost"
                        to={f.paths[0]}
                        aria-label={`Open ${f.label}`}
                        data-testid={`lab-open-${f.id}`}
                      >
                        Open →
                      </Btn>
                    </>
                  }
                />
              )
            })}
          </SettingsList>
        )
      })}
    </div>
  )
}
