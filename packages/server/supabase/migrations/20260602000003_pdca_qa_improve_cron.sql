-- Phase 3: PDCA QA story auto-improve cron
-- Runs every 6 hours to find failed qa_story_runs and propose improvements.
-- The pdca-runner edge function handles mode='qa_story_improve'.

SELECT cron.schedule(
  'pdca-qa-story-improve',
  '0 */6 * * *',
  $$
    SELECT net.http_post(
      url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/pdca-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
      ),
      body    := '{"mode":"qa_story_improve"}'::jsonb
    );
  $$
);
