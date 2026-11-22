/**
 * FILE: apps/admin/src/lib/kensaurusOpsTypes.ts
 * PURPOSE: The kensaurus-ops operator API as the console sees it, through
 *          GET/POST /v1/admin/kensaurus/ops (packages/server api/routes/kensaurus-ops.ts).
 *          Mirrors yen-yen docs/kensaurus-provider-watch.md "Operator console API"
 *          and supabase/functions/_shared/kensaurus-ops.ts. Money is micro-USD.
 */

export type ProviderState = 'ok' | 'warn' | 'down' | 'stale' | 'unknown'

interface ProviderStatus {
  state: ProviderState
  state_since: string | null
  pending_state: string | null
  class: string | null
  last_probe_at: string | null
  last_ok_at: string | null
  http_status: number | null
  balance_micro: number | null
  /** Probe-specific: { balance, currency } or { tier, status, character_count, character_limit, … }. */
  usage: Record<string, unknown> | null
  detail: string | null
}

export interface ProviderAccount {
  /** `<project>:<provider>`, e.g. kenji:openai. */
  id: string
  provider: string
  label: string
  host_project: string
  origin: string
  probe_kind: string
  secret_name: string | null
  depends: Array<{ app: string; feature?: string }>
  /** warn_balance / crit_balance are in dollars, not micro-USD. */
  thresholds: Record<string, unknown>
  enabled: boolean
  is_test: boolean
  updated_at: string
  updated_by: string
  status: ProviderStatus | null
}

interface ProviderIncident {
  id: number
  fingerprint: string
  account_id: string | null
  app: string | null
  feature: string | null
  provider: string | null
  model: string | null
  class: string
  source: 'probe' | 'reactive' | 'anomaly'
  severity: 'warn' | 'crit'
  count: number
  first_seen: string
  last_seen: string
  alerted_at: string | null
}

interface SpendRow {
  app: string
  provider: string
  calls: number
  errors: number
  cost_micro: number | null
  sell_micro: number | null
}

export interface SpendDigest {
  since: string
  rows: SpendRow[]
  liability_micro: number
}

export interface SpendHour extends SpendRow {
  hour: string
}

export interface RouteParams {
  max_output_tokens?: number
  temperature?: number
  reasoning_effort?: string
  thinking?: { type: string; budget_tokens?: number }
  /** Anthropic only (yen-yen PR 551). */
  effort?: string
  secret_name?: string
  [key: string]: unknown
}

export interface AiRoute {
  app: string
  /** '*' is the app default. */
  feature: string
  priority: number
  provider: string
  model: string
  params: RouteParams
  enabled: boolean
  note: string | null
  updated_at: string
  updated_by: string
  provider_state: ProviderState
}

export interface RouteChange {
  id: number
  changed_at: string
  changed_by: string | null
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  app: string
  feature: string
  priority: number
  before: Partial<AiRoute> | null
  after: Partial<AiRoute> | null
}

export interface ProviderChange {
  id: number
  changed_at: string
  changed_by: string | null
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  account_id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export interface ModelPrice {
  provider: string
  model: string
  unit_kind: string
  input_per_mtok_micro: number | null
  output_per_mtok_micro: number | null
  cached_input_per_mtok_micro: number | null
  per_unit_micro: number | null
  effective_from: string
}

export interface OpsSnapshot {
  generated_at: string
  providers: ProviderAccount[]
  incidents: ProviderIncident[]
  spend: { last_24h: SpendDigest; last_30d: SpendDigest }
  spend_hourly: SpendHour[]
  routes: AiRoute[]
  route_changes: RouteChange[]
  provider_changes: ProviderChange[]
  prices: ModelPrice[]
}

export interface OpsMeta {
  version: number
  route_providers: string[]
  priority: { min: number; max: number }
  /** Each key → a description string, or the allowed values. */
  route_params: Record<string, unknown>
  /**
   * The providers each provider-specific param applies to, e.g.
   * `{ reasoning_effort: ['openai'], thinking: ['anthropic'] }`; a param not listed applies to
   * any provider. Newer upstreams only (yen-yen kensaurus-ops contract, 2026-11-18): absent
   * means the console's built-in map (lib/providersView.ts PARAM_PROVIDER).
   */
  route_param_providers?: Record<string, string[]>
  threshold_keys: string[]
  actions: string[]
  /** Present once upstream takes `batch` (yen-yen kensaurus-ops, 2026-11-21). */
  batch?: { max_ops: number; max_body_bytes: number }
}

/** GET /v1/admin/kensaurus/ops → data. */
export interface OpsReadResponse {
  meta: OpsMeta | null
  snapshot: OpsSnapshot
  fetched_at: string
  cached: boolean
}

type RouteKey = { app: string; feature: string; priority: number }

/** One route change: alone, or one op of a `batch`. */
type RouteWrite =
  | ({ action: 'upsert_route' } & RouteKey & {
      provider: string
      model: string
      params?: RouteParams
      enabled?: boolean
      note?: string | null
    })
  | ({ action: 'enable_route' | 'disable_route' | 'delete_route' } & RouteKey)
  | { action: 'reorder'; app: string; feature: string; order: number[] }

export type OpsAction =
  | RouteWrite
  /**
   * One chain save: every op for one app, in order, in one transaction upstream; refused whole
   * (409 stale) when a feature's rows no longer match `expect`. One hub notice for all of it.
   */
  | {
      action: 'batch'
      app: string
      ops: RouteWrite[]
      expect?: Array<{ feature: string; count: number; updated_at: string | null }>
      note?: string
    }
  | { action: 'set_provider_enabled'; account_id: string; enabled: boolean }
  | { action: 'set_provider_thresholds'; account_id: string; thresholds: Record<string, unknown> }

/** POST /v1/admin/kensaurus/ops → data. */
export interface OpsWriteResponse {
  action: string
  result: unknown
}
