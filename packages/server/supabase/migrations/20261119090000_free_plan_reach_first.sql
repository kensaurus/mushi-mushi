-- Reach-first free plan (owner, 2026-11-19: "anything to increase user reach, visibility,
-- user takeup, acquisition is priority - profit and money making can come later").
--
-- Measured cost of one hosted diagnosis, last 30 days of llm_invocations: classify-report
-- $0.0071 avg + fast-filter $0.0008 + judge $0.0036 ~= $0.012. 300 a month is ~$3.60 for a
-- free org that uses all of it. Projects that bring their own key are not capped at all
-- (byokLiftsFreeCap in _shared/quota.ts), so this cap only bounds Mushi Mushi's own spend.
--
-- Benchmarks read 2026-11-19: Langfuse Hobby 50k units, 30 days, 2 users, no card;
-- Sentry Developer 5k errors, 1 user. Vibe coders run several small apps, so 1 app was
-- the first wall a new user hit.
update public.pricing_plans
set max_projects = 3,
    included_diagnoses_per_month = 300,
    retention_days = 30,
    feature_flags = feature_flags || jsonb_build_object(
      'plugins', true,             -- Linear, Jira, Discord, Teams… on the free plan
      'plugin_marketplace', true,
      'usage_alerts', true         -- warn before the cap, never a silent stop
    ),
    updated_at = now()
where id = 'free_cloud';
