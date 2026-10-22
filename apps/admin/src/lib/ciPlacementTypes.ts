/**
 * FILE: apps/admin/src/lib/ciPlacementTypes.ts
 * PURPOSE: The contract of the CI placement routes (Plan 022 Phase 7b,
 *          ADR 0037), copied from the server's `_shared/ci-placement.ts` and
 *          `api/routes/ci-placement.ts`. Change the server first, then copy.
 */

type PlacementAction = 'set_actions_variable' | 'delete_actions_variable'
export type PlacementTarget = { kind: 'github_hosted'; label: string | null } | { kind: 'self_hosted'; label: string }

interface ExternalController {
  name: string
  owner: string
  repos: string[]
  note: string | null
}

export interface CiRunnerPolicy {
  organizationId: string
  noPaidHostedOnPrivate: boolean
  hostedAllowedRepos: string[]
  externalControllers: ExternalController[]
  standbyRunners: string[]
  sourceNote: string | null
  updatedAt: string | null
}

interface VariableState {
  exists: boolean
  value: string | null
  updatedAt: string | null
}

interface PlacementPayload {
  repo: string
  name: string
  value: string | null
  expected: VariableState
  jobs: Array<{ workflow: string; job: string }>
  expectedLabels: string[]
  revertOf?: string
}

export interface PlacementPreview {
  repo: string
  projectId: string
  visibility: 'public' | 'private' | 'unknown'
  variable: string
  action: PlacementAction
  current: VariableState | null
  next: { value: string | null; target: PlacementTarget }
  now: { target: PlacementTarget }
  jobs: {
    moves: Array<{ workflow: string; workflowPath: string; job: string; fallback: string | null; mainStays: boolean; dependabotStays: boolean }>
    stays: Array<{ workflow: string; workflowPath: string; job: string; why: 'pinned_hosted' | 'pinned_self_hosted' | 'other_variable' | 'expression'; detail: string }>
  }
  target: { label: string | null; runners: number; online: number; busy: number; waitP95s: number | null } | null
  cost: { monthCostDelta: number; currency: string; note: string } | null
  policy: { allowed: boolean; code: string | null; reason: string | null; controller: ExternalController | null }
  warnings: string[]
  payload: PlacementPayload | null
  blocked: { code: string; message: string } | null
}

export interface PlacementRequestRow {
  id: string
  project_id: string | null
  action: PlacementAction
  payload: PlacementPayload
  payload_sha256: string
  reason: string | null
  status: 'pending_approval' | 'approved' | 'rejected' | 'executing' | 'executed' | 'failed' | 'expired'
  requested_by: string
  requested_at: string
  approved_by: string | null
  approved_at: string | null
  expires_at: string | null
  executed_at: string | null
  result: Record<string, unknown> | null
  error: string | null
}

export interface PlacementWatchRow {
  id: string
  action_id: string
  repo: string
  variable: string
  previous_value: string | null
  new_value: string | null
  status: 'watching' | 'ok' | 'alert' | 'reverted' | 'expired'
  jobs_seen: number
  unexpected: number
  slow: number
  started_at: string
  revert_action_id: string | null
}

export interface PlacementRepo {
  repo: string
  visibility: 'public' | 'private' | 'unknown'
  workflowsRead: boolean
  controller: ExternalController | null
  variables: Array<{ name: string; jobs: number; fallbacks: string[]; allowed: boolean; current: VariableState | null }>
  labels: Array<{ label: string; runners: number; online: number }>
}

/** GET /v1/admin/ci/placement */
export interface CiPlacement {
  projectId: string
  organizationId: string
  policy: CiRunnerPolicy | null
  policyWritable: boolean
  tokenStored: boolean
  repos: PlacementRepo[]
  requests: PlacementRequestRow[]
  watches: PlacementWatchRow[]
  canDecide: boolean
  canRequest: boolean
}

/** GET/PUT /v1/admin/ci/policy */
export interface CiPolicyResponse {
  organizationId: string
  policy: CiRunnerPolicy | null
  writable: boolean
  canEdit: boolean
  canLift: boolean
}
