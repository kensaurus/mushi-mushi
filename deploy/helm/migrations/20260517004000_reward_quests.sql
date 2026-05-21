-- Migration: reward_quests
-- PURPOSE: P3 rewards — multi-step goal tracking.
--   `reward_quests` defines named quests with ordered steps.
--   `quest_progress` tracks per-user step completion.
--   When all steps complete, points are awarded and a webhook fires.
--   Built on top of the existing end_user_activity breadcrumb buffer.

-- ── reward_quests ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reward_quests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  name            text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description     text,
  -- Ordered array of steps; each step is { action, label, metadata_match? }
  -- e.g. [{"action": "screen_view", "label": "Visit /pricing", "metadata_match": {"path": "/pricing"}},
  --        {"action": "button_click", "label": "Click Compare"}]
  steps           jsonb       NOT NULL DEFAULT '[]',
  -- Bonus points awarded on quest completion (on top of per-action points)
  completion_points int       NOT NULL DEFAULT 0 CHECK (completion_points >= 0),
  -- Optional time limit: quest expires if not completed within this many days
  expires_after_days int      CHECK (expires_after_days IS NULL OR expires_after_days > 0),
  enabled         boolean     NOT NULL DEFAULT true,
  -- Repeatable: if true, quest resets after completion and can be earned again
  repeatable      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER reward_quests_updated_at
  BEFORE UPDATE ON public.reward_quests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reward_quests_org
  ON public.reward_quests (organization_id) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_reward_quests_project
  ON public.reward_quests (project_id) WHERE enabled = true;

ALTER TABLE public.reward_quests ENABLE ROW LEVEL SECURITY;

CREATE POLICY reward_quests_org_member_select ON public.reward_quests
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

CREATE POLICY reward_quests_org_admin_write ON public.reward_quests
  FOR ALL TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['admin']));

COMMENT ON TABLE public.reward_quests IS
  'P3 Rewards: Multi-step goal definitions. Steps are matched against end_user_activity entries in order. Completion fires a webhook and awards bonus points.';

-- ── quest_progress ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quest_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  quest_id        uuid        NOT NULL REFERENCES public.reward_quests(id) ON DELETE CASCADE,
  end_user_id     uuid        NOT NULL REFERENCES public.end_users(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Index of the next step to complete (0-based; = steps.length means complete)
  next_step_index int         NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed', 'expired', 'abandoned')),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz,
  -- Link to the end_user_activity row that completed the quest
  completing_activity_id uuid REFERENCES public.end_user_activity(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Only one active progress row per (quest, end_user) unless repeatable
  CONSTRAINT quest_progress_unique_active UNIQUE NULLS NOT DISTINCT (quest_id, end_user_id, status)
);

CREATE OR REPLACE TRIGGER quest_progress_updated_at
  BEFORE UPDATE ON public.quest_progress
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_quest_progress_user
  ON public.quest_progress (end_user_id, status);

CREATE INDEX IF NOT EXISTS idx_quest_progress_quest
  ON public.quest_progress (quest_id, status);

CREATE INDEX IF NOT EXISTS idx_quest_progress_expires
  ON public.quest_progress (expires_at)
  WHERE status = 'in_progress' AND expires_at IS NOT NULL;

ALTER TABLE public.quest_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY quest_progress_org_member_select ON public.quest_progress
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

COMMENT ON TABLE public.quest_progress IS
  'P3 Rewards: Per-user progress through a reward quest. next_step_index advances as actions are matched. Status transitions to completed when all steps are done.';

-- ── Cron: expire stale quest_progress rows ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-quest-progress',
      '30 3 * * *',  -- daily at 03:30 UTC
      $sql$
        UPDATE public.quest_progress
        SET status = 'expired', updated_at = now()
        WHERE status = 'in_progress'
          AND expires_at IS NOT NULL
          AND expires_at < now();
      $sql$
    );
  END IF;
END;
$$;
