-- The agent PR review model is a setting, not a constant (ADR 0030; owner
-- yardstick 2026-10-22: "if the models get better, does Mushi get better?").
--
-- Null keeps the platform default: the AGENT_PR_REVIEW_MODEL edge secret
-- when set, else the code constant (claude-opus-5-5). A project admin can
-- point its reviews at a newer Claude model through
-- PATCH /v1/admin/projects/:id/settings without a deploy. The review runs
-- on the project's own Anthropic key, so the API accepts Claude ids only.

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS agent_pr_review_model text;

COMMENT ON COLUMN public.project_settings.agent_pr_review_model IS
  'Claude model for the agent PR review (agent-pr-review). Null: the AGENT_PR_REVIEW_MODEL secret, else the code default.';
