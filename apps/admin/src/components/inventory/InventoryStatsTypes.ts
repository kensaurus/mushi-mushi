/**
 * FILE: apps/admin/src/components/inventory/InventoryStatsTypes.ts
 * PURPOSE: Inventory shell stats — banner + INVENTORY SNAPSHOT strip.
 */

export type InventoryTabId =
  | 'overview'
  | 'stories'
  | 'tree'
  | 'gates'
  | 'synthetic'
  | 'drift'
  | 'discovery'
  | 'yaml'

export type InventoryTopPriority =
  | 'no_inventory'
  | 'discovery_ready'
  | 'regressed'
  | 'open_findings'
  | 'stub_heavy'
  | 'clear'

export interface InventoryStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasGithub: boolean
  hasInventory: boolean
  discoveryEvents: number
  draftProposals: number
  total: number
  verified: number
  wired: number
  mocked: number
  stub: number
  regressed: number
  unknown: number
  userStories: number
  openFindings: number
  lastIngestAt: string | null
  lastGateRunAt: string | null
  commitSha: string | null
  topPriority: InventoryTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_INVENTORY_STATS: InventoryStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasGithub: false,
  hasInventory: false,
  discoveryEvents: 0,
  draftProposals: 0,
  total: 0,
  verified: 0,
  wired: 0,
  mocked: 0,
  stub: 0,
  regressed: 0,
  unknown: 0,
  userStories: 0,
  openFindings: 0,
  lastIngestAt: null,
  lastGateRunAt: null,
  commitSha: null,
  topPriority: 'no_inventory',
  topPriorityLabel: null,
  topPriorityTo: null,
}
