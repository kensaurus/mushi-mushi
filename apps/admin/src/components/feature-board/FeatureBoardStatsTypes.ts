/**
 * FILE: FeatureBoardStatsTypes.ts
 * PURPOSE: Client-derived feature board ticket counts for readout band on /feature-board.
 */

export interface FeatureBoardClientStats {
  projectId: string | null
  openCount: number
  shippedCount: number
  totalVotes: number
  totalTickets: number
  topRequestSubject: string | null
}

export const EMPTY_FEATURE_BOARD_CLIENT_STATS: FeatureBoardClientStats = {
  projectId: null,
  openCount: 0,
  shippedCount: 0,
  totalVotes: 0,
  totalTickets: 0,
  topRequestSubject: null,
}
