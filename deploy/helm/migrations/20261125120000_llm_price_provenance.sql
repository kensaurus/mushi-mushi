-- ============================================================================
-- FILE: 20261125120000_llm_price_provenance.sql
-- PURPOSE: Every LLM cost says which price produced it (cost catalog program,
--          owner-approved 2026-11-25). Mushi Mushi no longer keeps a price
--          table: _shared/llm-cost.ts prices each call with priceFor from the
--          shared KENSAURUS catalog (Supabase project kensaurus-shared). The
--          local table in _shared/pricing.ts and its SQL mirror in
--          20260420000200_llm_cost_usd.sql are retired; that migration's
--          backfill stays as history.
--
--   1. llm_invocations.price_source / price_version / price_tier /
--      unpriced_reason. A call the catalog cannot price keeps cost_usd NULL
--      and says why in unpriced_reason: never $0, never a fallback rate.
--   2. llm_cost_reconciliations: one row per (connector instance, day), the
--      vendor's billed cost (OpenAI /v1/organization/costs, Anthropic
--      cost_report) against Mushi Mushi's own ledger for the same apps.
--      Written by the llm-cost-reconcile function; read by the Costs page.
--
-- ADDITIVE ONLY. Service role writes; the API reads after its own membership
-- check, like the other cost tables.
-- ============================================================================

-- ── 1. Price provenance on llm_invocations ──────────────────────────────────
alter table public.llm_invocations
  add column if not exists price_source text,
  add column if not exists price_version timestamptz,
  add column if not exists price_tier text,
  add column if not exists unpriced_reason text;

comment on column public.llm_invocations.cost_usd is
  'USD cost of the call, priced at write time by priceFor over the shared KENSAURUS catalog (_shared/llm-cost.ts). NULL = unpriced: the catalog had no price in force (see unpriced_reason). Never a fallback rate.';
comment on column public.llm_invocations.price_source is
  'Where the price came from: the catalog row''s source (pricing_page, vendor_api, catalog:openrouter, legacy for a hand-entered row), override:<source> for a kensaurus_price_overrides row, no_usage for a call with no billable usage. NULL with cost_usd NULL = unpriced; NULL with a cost = priced before 2026-11-25 by the retired local table.';
comment on column public.llm_invocations.price_version is
  'effective_from of the catalog or override row that priced the call.';
comment on column public.llm_invocations.price_tier is
  'base, or the prompt-size tier that applied (prompt_tokens_gt:100000).';
comment on column public.llm_invocations.unpriced_reason is
  'Why the call could not be priced (no price in force, no price source configured, lookup failed). Set only when cost_usd is NULL.';

-- A PDCA iteration whose model call was unpriced records NULL, not $0.
alter table public.pdca_iterations alter column model_cost_usd drop not null;
comment on column public.pdca_iterations.model_cost_usd is
  'USD cost of the iteration''s model calls from the shared price catalog; NULL = unpriced.';

-- The Costs page lists unpriced usage per model; keep that read small.
create index if not exists idx_llm_inv_unpriced
  on public.llm_invocations (project_id, created_at desc)
  where cost_usd is null;

-- ── 2. Reconciliation against the vendors' cost reports ─────────────────────
create table if not exists public.llm_cost_reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connector_instance_id uuid not null references public.connector_instances(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  day date not null,
  status text not null check (status in ('ok', 'gap', 'skipped', 'error')),
  vendor_usd numeric(14, 6),
  ledger_usd numeric(14, 6),
  ledger_unpriced_calls integer not null default 0,
  gap_usd numeric(14, 6),
  gap_pct numeric(9, 4),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.llm_cost_reconciliations is
  'Daily check of Mushi Mushi''s priced LLM ledger against what OpenAI / Anthropic billed for the same apps (llm-cost-reconcile). status gap = |gap_pct| > 3. skipped = the admin key is missing or nothing is bound; detail.reason says which. A provider with no llm_usage connector has no row: the Costs page says no admin key.';

create unique index if not exists llm_cost_reconciliations_instance_day
  on public.llm_cost_reconciliations (connector_instance_id, day);
create index if not exists llm_cost_reconciliations_org_day
  on public.llm_cost_reconciliations (organization_id, day desc);

alter table public.llm_cost_reconciliations enable row level security;
revoke all on public.llm_cost_reconciliations from anon, authenticated;
grant all on public.llm_cost_reconciliations to service_role;
