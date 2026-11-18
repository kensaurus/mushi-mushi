/**
 * FILE: apps/admin/src/lib/__fixtures__/opsSnapshot.ts
 * PURPOSE: A kensaurus-ops snapshot for /providers tests: three accounts
 *          (one down on balance, one warn on usage, one ok), one crit
 *          incident, a 24 h digest where yen-yen loses money on anthropic,
 *          two apps with routes, prices and a little history.
 */

import type { AiRoute, OpsMeta, OpsReadResponse, OpsSnapshot } from '../kensaurusOpsTypes'

export const NOW = Date.parse('2026-11-18T12:00:00Z')

export const opsMeta: OpsMeta = {
  version: 1,
  route_providers: ['openai', 'anthropic', 'together', 'openrouter'],
  priority: { min: 1, max: 9 },
  route_params: {
    max_output_tokens: 'integer 1..64000',
    temperature: 'number 0..2',
    reasoning_effort: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
    thinking: { type: ['disabled', 'enabled', 'adaptive'], budget_tokens: 'integer 1024..64000, required for enabled' },
    secret_name: 'edge secret NAME',
  },
  threshold_keys: ['warn_balance', 'crit_balance', 'expected_tier', 'ok_statuses', 'warn_pct_used', 'crit_pct_used', 'stale_after_min', 'console_url'],
  actions: ['upsert_route', 'enable_route', 'disable_route', 'delete_route', 'reorder', 'set_provider_enabled', 'set_provider_thresholds'],
}

const route = (r: Partial<AiRoute> & Pick<AiRoute, 'app' | 'feature' | 'priority' | 'provider' | 'model'>): AiRoute => ({
  params: {},
  enabled: true,
  note: null,
  updated_at: '2026-11-18T10:00:00Z',
  updated_by: 'migration',
  provider_state: 'ok',
  ...r,
})

export function opsSnapshot(): OpsSnapshot {
  return {
    generated_at: '2026-11-18T12:00:00Z',
    providers: [
      {
        id: 'kenji:openai',
        provider: 'openai',
        label: 'OpenAI (kenji)',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'billing',
        secret_name: 'OPENAI_API_KEY',
        depends: [{ app: 'yen-yen' }, { app: 'glot-it' }, { app: 'yen-yen', feature: 'chat' }],
        thresholds: { warn_balance: 20, crit_balance: 5 },
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'down',
          state_since: '2026-11-18T09:00:00Z',
          pending_state: null,
          class: 'low_balance',
          last_probe_at: '2026-11-18T11:58:00Z',
          last_ok_at: '2026-11-18T08:55:00Z',
          http_status: 200,
          balance_micro: 3_200_000,
          usage: { balance: 3.2, currency: 'USD' },
          detail: '3.20 USD left',
        },
      },
      {
        id: 'kenji:elevenlabs',
        provider: 'elevenlabs',
        label: 'ElevenLabs',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'subscription',
        secret_name: 'ELEVENLABS_API_KEY',
        depends: [{ app: 'glot-it' }],
        thresholds: { warn_pct_used: 0.8, crit_pct_used: 0.95 },
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'warn',
          state_since: '2026-11-18T11:00:00Z',
          pending_state: null,
          class: 'low_balance',
          last_probe_at: '2026-11-18T11:59:00Z',
          last_ok_at: '2026-11-18T11:59:00Z',
          http_status: 200,
          balance_micro: null,
          usage: { tier: 'creator', character_count: 85_000, character_limit: 100_000 },
          detail: "85% of this period's characters used",
        },
      },
      {
        id: 'kenji:anthropic',
        provider: 'anthropic',
        label: 'Anthropic',
        host_project: 'kenji',
        origin: 'pull',
        probe_kind: 'auth_only',
        secret_name: 'ANTHROPIC_API_KEY',
        depends: [{ app: 'yen-yen' }],
        thresholds: {},
        enabled: true,
        is_test: false,
        updated_at: '2026-11-18T09:00:00Z',
        updated_by: 'migration',
        status: {
          state: 'ok',
          state_since: '2026-11-17T12:00:00Z',
          pending_state: null,
          class: null,
          last_probe_at: '2026-11-18T11:59:30Z',
          last_ok_at: '2026-11-18T11:59:30Z',
          http_status: 200,
          balance_micro: null,
          usage: {},
          detail: 'Key accepted',
        },
      },
    ],
    incidents: [
      {
        id: 7,
        fingerprint: 'fp7',
        account_id: 'kenji:openai',
        app: 'yen-yen',
        feature: 'chat',
        provider: 'openai',
        model: 'gpt-6-luna',
        class: 'payment',
        source: 'reactive',
        severity: 'crit',
        count: 4,
        first_seen: '2026-11-18T09:05:00Z',
        last_seen: '2026-11-18T11:40:00Z',
        alerted_at: '2026-11-18T09:06:00Z',
      },
    ],
    spend: {
      last_24h: {
        since: '2026-11-17T12:00:00Z',
        rows: [
          { app: 'yen-yen', provider: 'anthropic', calls: 40, errors: 2, cost_micro: 9_000_000, sell_micro: 6_000_000 },
          { app: 'yen-yen', provider: 'openai', calls: 100, errors: 0, cost_micro: 2_000_000, sell_micro: 5_000_000 },
          { app: 'glot-it', provider: 'openai', calls: 10, errors: 1, cost_micro: 500_000, sell_micro: 1_000_000 },
        ],
        liability_micro: 123_450_000,
      },
      last_30d: {
        since: '2026-10-19T12:00:00Z',
        rows: [{ app: 'yen-yen', provider: 'openai', calls: 3000, errors: 12, cost_micro: 60_000_000, sell_micro: 150_000_000 }],
        liability_micro: 123_450_000,
      },
    },
    spend_hourly: [
      { hour: '2026-11-18T11:00:00Z', app: 'yen-yen', provider: 'openai', calls: 5, errors: 1, cost_micro: 2000, sell_micro: 5000 },
      { hour: '2026-11-18T10:00:00Z', app: 'glot-it', provider: 'openai', calls: 2, errors: 0, cost_micro: 1000, sell_micro: 2000 },
      { hour: '2026-11-18T10:00:00Z', app: 'yen-yen', provider: 'openai', calls: 3, errors: 0, cost_micro: 1500, sell_micro: 3000 },
    ],
    routes: [
      route({ app: 'yen-yen', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6-luna', params: { reasoning_effort: 'none' }, provider_state: 'down' }),
      route({ app: 'yen-yen', feature: '*', priority: 3, provider: 'anthropic', model: 'claude-haiku-5-5', params: { effort: 'high' } }),
      route({ app: 'yen-yen', feature: 'chat', priority: 1, provider: 'anthropic', model: 'claude-haiku-5-5', enabled: false }),
      route({ app: 'glot-it', feature: '*', priority: 1, provider: 'openai', model: 'gpt-6-luna' }),
    ],
    route_changes: [
      {
        id: 11,
        changed_at: '2026-11-18T10:00:00Z',
        changed_by: 'console:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        op: 'UPDATE',
        app: 'yen-yen',
        feature: '*',
        priority: 1,
        before: { model: 'gpt-6', enabled: true, updated_at: '2026-11-17T10:00:00Z' },
        after: { model: 'gpt-6-luna', enabled: true, updated_at: '2026-11-18T10:00:00Z' },
      },
    ],
    provider_changes: [
      {
        id: 3,
        changed_at: '2026-11-18T11:00:00Z',
        changed_by: 'migration',
        op: 'UPDATE',
        account_id: 'kenji:elevenlabs',
        before: { enabled: false },
        after: { enabled: true },
      },
    ],
    prices: [
      { provider: 'anthropic', model: 'claude-haiku-5-5', unit_kind: 'tokens', input_per_mtok_micro: 1, output_per_mtok_micro: 5, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-10-08T00:00:00Z' },
      { provider: 'anthropic', model: 'claude-opus-5-5', unit_kind: 'tokens', input_per_mtok_micro: 15, output_per_mtok_micro: 75, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-09-26T00:00:00Z' },
      { provider: 'openai', model: 'gpt-6-luna', unit_kind: 'tokens', input_per_mtok_micro: 0, output_per_mtok_micro: 0, cached_input_per_mtok_micro: null, per_unit_micro: null, effective_from: '2026-11-01T00:00:00Z' },
    ],
  }
}

export function opsRead(): OpsReadResponse {
  return { meta: opsMeta, snapshot: opsSnapshot(), fetched_at: '2026-11-18T12:00:00Z', cached: false }
}
