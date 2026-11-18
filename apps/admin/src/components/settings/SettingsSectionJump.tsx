/**
 * FILE: apps/admin/src/components/settings/SettingsSectionJump.tsx
 * PURPOSE: On a phone, General runs to ~6,100px with every section open. A
 *          sticky "Jump to" select at the top of the tab moves straight to a
 *          section (fresh-eyes 2026-11-18). Hidden from sm up, where the
 *          sections fit a few screens.
 */

import { SETTINGS_SECTION_IDS } from '../../lib/settingsTabs'

/** General's sections, in page order (ids set on each SettingsList / card). */
export const GENERAL_SECTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'slack', label: 'Bug alerts' },
  { id: 'error-tracking', label: 'Error tracking' },
  { id: 'supabase', label: 'Your database' },
  { id: 'bug-sorting', label: 'Bug sorting' },
  { id: 'daily-limits', label: 'Daily limits' },
  { id: 'widget', label: 'Feedback widget' },
  { id: 'spend-limits', label: 'Spend limits' },
  { id: SETTINGS_SECTION_IDS.opsSlackBot, label: 'Team Slack bot' },
]

export function SettingsSectionJump({ sections = GENERAL_SECTIONS }: { sections?: ReadonlyArray<{ id: string; label: string }> }) {
  return (
    <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 py-1.5 sm:hidden" data-testid="settings-section-jump">
      <label className="flex items-center gap-2 text-xs text-fg-secondary">
        <span className="shrink-0">Jump to</span>
        <select
          className="min-w-0 flex-1 rounded-sm border border-edge-subtle bg-surface-raised px-2 py-1.5 text-sm text-fg"
          value=""
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
        >
          <option value="">Pick a section</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
