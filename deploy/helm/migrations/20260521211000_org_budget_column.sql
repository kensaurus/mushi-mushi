-- Migration: Round 9 — Cost forecast + budget alert column (2026-05-21)
-- Phase E5: adds monthly_llm_budget_usd to project_settings so the
-- BudgetForecastCard can persist user-set budget targets per project.
-- Budget alert is surfaced client-side in the BudgetForecastCard (no
-- notifications table exists yet; a future migration can wire server-side
-- alerts once the admin notification infrastructure is in place).

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS monthly_llm_budget_usd numeric(10, 4)
    CHECK (monthly_llm_budget_usd IS NULL OR monthly_llm_budget_usd > 0);

COMMENT ON COLUMN public.project_settings.monthly_llm_budget_usd IS
  'Optional monthly LLM cost budget in USD (set by the project owner from
   the Cost → Overview tab). When the 14-day linear spend forecast exceeds
   80% of this value, the BudgetForecastCard shows an inline warning.
   NULL = no budget set (no alert fires).';
