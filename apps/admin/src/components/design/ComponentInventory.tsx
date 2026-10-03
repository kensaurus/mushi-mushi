/**
 * FILE: apps/admin/src/components/design/ComponentInventory.tsx
 * PURPOSE: The app's declared component primitives (name + defining file),
 *          matched from mushi.recipe.json's component globs.
 */

import type { DesignComponentEntry } from '../../lib/recipeTypes'

export function ComponentInventory({ components }: { components: DesignComponentEntry[] }) {
  if (components.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No component inventory. Declare component globs in mushi.recipe.json to list your primitives.
      </p>
    )
  }
  return (
    <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {components.map((c) => (
        <li key={`${c.name}:${c.file}`} className="flex flex-wrap items-baseline gap-2 text-xs">
          <span className="font-medium text-fg">{c.name}</span>
          <span className="font-mono text-2xs text-fg-faint wrap-break-word">{c.file}</span>
        </li>
      ))}
    </ul>
  )
}
