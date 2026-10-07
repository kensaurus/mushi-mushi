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

interface GateInfo {
  /** What the check looks at and what runs it, in one line. */
  checks: string
  /** Where its findings are worked on, when a page owns them. */
  page: { label: string; to: string } | null
}

const INVENTORY_PAGE = { label: 'Open the app map', to: '/inventory' }

const GATE_INFO: Record<GateId, GateInfo> = {
  dead_handler: { checks: 'Buttons and links whose handler does nothing. Runs with "Run audit".', page: INVENTORY_PAGE },
  mock_leak: { checks: 'Mock or sample data that reaches production code. Runs with "Run audit".', page: INVENTORY_PAGE },
  api_contract: { checks: 'Frontend calls whose request or response does not match the API. Runs with "Run audit".', page: INVENTORY_PAGE },
  crawl: { checks: 'Every page in the app map is loaded live; failures and pages missing from the map are listed. Runs with "Run audit".', page: INVENTORY_PAGE },
  status_claim: { checks: 'Pages marked done in the app map whose checks fail. Runs with "Run audit".', page: INVENTORY_PAGE },
  spec_drift: { checks: 'The OpenAPI spec compared with the routes in code. Runs with "Run audit".', page: INVENTORY_PAGE },
  orphan_endpoint: { checks: 'Backend endpoints nothing calls. Runs with "Run audit".', page: INVENTORY_PAGE },
  unknown_call: { checks: 'Frontend calls to endpoints the backend does not have. Runs with "Run audit".', page: INVENTORY_PAGE },
  schema_drift: { checks: 'Your Supabase schema, read daily (03:05 UTC) and compared with the previous read: each changed table is listed to check against the frontend.', page: { label: 'Open schema changes', to: '/health?view=schema' } },
  code_health: { checks: 'Bundle size and very large files, pushed from your CI.', page: { label: 'Open code size', to: '/health?view=code' } },
  design_drift: { checks: 'Hard-coded colours, spacing and type that bypass your design tokens, scanned daily (03:35 UTC) from the repo.', page: { label: 'Open the design system', to: '/design' } },
  ci_drift: { checks: 'Your CI workflows compared with mushi.recipe.json.', page: { label: 'Open the app blueprint', to: '/recipe' } },
  deploy_drift: { checks: 'Merged commits that never reached a declared deploy target.', page: { label: 'Open releases', to: '/releases' } },
  env_drift: { checks: 'Env var names in GitHub compared with mushi.recipe.json.', page: { label: 'Open the app blueprint', to: '/recipe' } },
  radar: { checks: 'Mushi setup: spend caps, keys and connections for this project.', page: { label: 'Open settings', to: '/settings' } },
  portfolio_radar: { checks: 'App hole checks, daily (04:05 UTC): store listings, domains, certificates, security headers, provider keys.', page: { label: 'Open the portfolio', to: '/portfolio' } },
  portfolio_radar_ci: { checks: 'App hole checks pushed from your CI (mushi radar scan --push).', page: { label: 'Open the portfolio', to: '/portfolio' } },
  store_review: { checks: 'The App Store and Play review checklist, read from the repo.', page: { label: 'Open releases', to: '/releases' } },
}

/** What a check looks at and where its findings are worked on (null for an unknown gate). */
export function gateInfo(gate: string): GateInfo | null {
  return isGateId(gate) ? GATE_INFO[gate] : null
}

function isGateId(gate: string): gate is GateId {
  return (GATE_IDS as readonly string[]).includes(gate)
}

/** The label for a gate; an unknown id is shown as-is rather than hidden. */
export function gateLabel(gate: string): string {
  return isGateId(gate) ? GATE_LABELS[gate] : gate
}
