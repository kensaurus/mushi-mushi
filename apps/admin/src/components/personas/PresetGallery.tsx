/**
 * FILE: apps/admin/src/components/personas/PresetGallery.tsx
 * PURPOSE: The persona presets (ADR 0073) as cards to add in one click: each
 *          one's picture, name, one line on who it is, its chips and Add.
 *          Saved, a preset is an ordinary persona the app can change.
 */

import { Btn, Card } from '../ui'
import type { PersonaPreset, PersonaPresetId } from '../../lib/personas'
import { PersonaAvatar } from './PersonaAvatar'
import { PersonaChips } from './PersonaCard'

export function PresetGallery({
  presets,
  canAdd,
  adding,
  onAdd,
}: {
  presets: readonly PersonaPreset[]
  /** False for a viewer, or when the app keeps as many personas as it may. */
  canAdd: boolean
  /** The preset being added right now. */
  adding: PersonaPresetId | null
  onAdd: (id: PersonaPresetId) => void
}) {
  return (
    <div className="@container/presets">
      <ul className="grid gap-3 @xl/presets:grid-cols-2 @4xl/presets:grid-cols-3" aria-label="Presets">
        {presets.map((p) => (
          <li key={p.id} className="min-w-0">
            <Card className="group flex h-full flex-col gap-2 p-3" data-testid="persona-preset">
              <div className="flex items-start gap-3">
                <PersonaAvatar persona={p} size="md" decorative />
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-fg">{p.name}</h3>
                  <p className="text-2xs text-fg-secondary">{p.blurb}</p>
                </div>
              </div>
              <PersonaChips persona={p} />
              {canAdd && (
                <div className="mt-auto pt-1">
                  <Btn size="sm" variant="ghost" onClick={() => onAdd(p.id)} loading={adding === p.id} disabled={adding != null && adding !== p.id} aria-label={`Add ${p.name}`}>
                    Add
                  </Btn>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
