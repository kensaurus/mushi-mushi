
type InventoryTopPriority =
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
