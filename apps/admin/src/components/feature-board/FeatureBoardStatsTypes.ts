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
