/**
 * FILE: apps/admin/src/components/ci/ciMapContext.ts
 * PURPOSE: Selection for the /ci runner map, read by each custom node through
 *          context so node `data` stays stable and React Flow never rebuilds
 *          the node array when the selection changes.
 */

import { createContext, useContext } from 'react'

export interface CiMapSelection {
  selectedId: string | null
  onSelect: (nodeId: string) => void
}

export const CiMapSelectContext = createContext<CiMapSelection>({ selectedId: null, onSelect: () => {} })

export function useCiMapSelection(): CiMapSelection {
  return useContext(CiMapSelectContext)
}
