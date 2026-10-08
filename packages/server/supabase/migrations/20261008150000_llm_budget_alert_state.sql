-- The AI budget alert tier already sent this month (usage-alerts →
-- _shared/llm-budget-alerts.ts): { "month": "YYYY-MM", "tier": 50 | 80 | 100 }.
-- One alert per threshold per month; null until the first alert.
alter table public.project_settings
  add column if not exists llm_budget_alert_state jsonb;

comment on column public.project_settings.llm_budget_alert_state is
  'Highest monthly AI budget alert sent this month: {"month":"YYYY-MM","tier":50|80|100}. Written by usage-alerts.';
