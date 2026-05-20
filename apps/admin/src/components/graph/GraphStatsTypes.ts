/**
 * FILE: apps/admin/src/components/graph/GraphStatsTypes.ts
 * PURPOSE: Graph shell stats — banner + GRAPH SNAPSHOT strip.
 */

export type GraphTabId = 'overview' | 'explore' | 'backend'

export type GraphTopPriority = 'waiting_ingest' | 'empty' | 'fragile' | 'regressions' | 'clear'

export interface GraphStats {
  hasAnyProject: boolean
  projectId: string | null
  projectName: string | null
  projectCount: number
  hasIngest: boolean
  nodeCount: number
  edgeCount: number
  reportNodes: number
  inventoryNodes: number
  fragileComponents: number
  regressionEdges: number
  duplicateEdges: number
  fixVerifiedEdges: number
  lastNodeAt: string | null
  graphBackend: string
  ageAvailable: boolean
  unsyncedNodes: number
  unsyncedEdges: number
  topPriority: GraphTopPriority
  topPriorityLabel: string | null
  topPriorityTo: string | null
}

export const EMPTY_GRAPH_STATS: GraphStats = {
  hasAnyProject: false,
  projectId: null,
  projectName: null,
  projectCount: 0,
  hasIngest: false,
  nodeCount: 0,
  edgeCount: 0,
  reportNodes: 0,
  inventoryNodes: 0,
  fragileComponents: 0,
  regressionEdges: 0,
  duplicateEdges: 0,
  fixVerifiedEdges: 0,
  lastNodeAt: null,
  graphBackend: 'sql_only',
  ageAvailable: false,
  unsyncedNodes: 0,
  unsyncedEdges: 0,
  topPriority: 'waiting_ingest',
  topPriorityLabel: null,
  topPriorityTo: null,
}
