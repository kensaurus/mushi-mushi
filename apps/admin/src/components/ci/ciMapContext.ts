/**
 * FILE: apps/admin/src/components/ci/ciMapContext.ts
 * PURPOSE: Selection for the /ci runner map, read by each custom node through
 *          context so node `data` stays stable and React Flow never rebuilds
 *          the node array when the selection changes.
 */

import { createContext, useContext } from 'react'

/** Map node ids for the two machines that are not a heartbeat host. */
export const UNKNOWN_HOST_ID = 'host:unknown'
export const GITHUB_HOST_ID = 'host:github'

export interface CiMapSelection {
  selectedId: string | null
  onSelect: (nodeId: string) => void
}

/** Null outside CiRunnerMap: nodes then render unselected and inert. */
export const CiMapSelectContext = createContext<CiMapSelection | null>(null)

export function useCiMapSelection(): CiMapSelection | null {
  return useContext(CiMapSelectContext)
}
