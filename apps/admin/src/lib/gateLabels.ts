/**
 * FILE: apps/admin/src/lib/gateLabels.ts
 * PURPOSE: Plain-English names for every gate a `gate_runs` row can carry.
 *
 * GATE_IDS mirrors the live `gate_runs_gate_check` constraint (migrations
 * 20260612061520, 20261002130100, 20261002140100 and 20261002180000) and the
 * MCP `GATE_IDS` in packages/mcp/src/server.ts. A gate missing here would
 * render as its raw id on the Full-stack audit page.
 */

const GATE_IDS = [
  'dead_handler',
  'mock_leak',
  'api_contract',
  'crawl',
  'status_claim',
  'spec_drift',
  'orphan_endpoint',
  'unknown_call',
  'schema_drift',
  'code_health',
  'design_drift',
  'ci_drift',
  'deploy_drift',
  'env_drift',
  'radar',
  'portfolio_radar',
  'portfolio_radar_ci',
  'store_review',
] as const

export type GateId = (typeof GATE_IDS)[number]

const GATE_LABELS: Record<GateId, string> = {
  dead_handler: 'Dead handlers (G1)',
  mock_leak: 'Mock data in production (G2)',
  api_contract: 'API contract (G3)',
  crawl: 'Live route crawl (G4)',
  status_claim: 'Status claims (G5)',
  spec_drift: 'OpenAPI spec drift (G6)',
  orphan_endpoint: 'Unused backend endpoints (G7)',
  unknown_call: 'Calls to unknown endpoints (G8)',
  schema_drift: 'Database schema drift',
  code_health: 'Code health (bundle size, big files)',
  design_drift: 'Code off the design tokens',
  ci_drift: 'CI differs from the recipe',
  deploy_drift: 'Merged but not deployed',
  env_drift: 'Env vars differ from the recipe',
  radar: 'Mushi setup checks',
  portfolio_radar: 'App hole checks',
  portfolio_radar_ci: 'App hole checks (from your CI)',
  store_review: 'Store review checklist',
}

function isGateId(gate: string): gate is GateId {
  return (GATE_IDS as readonly string[]).includes(gate)
}

/** The label for a gate; an unknown id is shown as-is rather than hidden. */
export function gateLabel(gate: string): string {
  return isGateId(gate) ? GATE_LABELS[gate] : gate
}
