-- Migrate model defaults to the Claude 4.6 family (sonnet-4-6 / opus-4-6).
-- Also upgrade rows still pointing at the deprecated 4 / 4-dated identifiers so
-- the next pipeline run picks up the new model without a settings round-trip.

-- project_settings.stage1_model
-- (Was named classification_model in the original phase0 draft; production was
-- renamed before phase1 shipped, so we target the live column name here.)
alter table project_settings
  alter column stage1_model set default 'claude-sonnet-4-6';

update project_settings
   set stage1_model = 'claude-sonnet-4-6'
 where stage1_model in ('claude-sonnet-4', 'claude-sonnet-4-20250514');

-- project_settings.stage2_model
alter table project_settings
  alter column stage2_model set default 'claude-sonnet-4-6';

update project_settings
   set stage2_model = 'claude-sonnet-4-6'
 where stage2_model in ('claude-sonnet-4', 'claude-sonnet-4-20250514');

-- project_settings.judge_model
alter table project_settings
  alter column judge_model set default 'claude-opus-4-6';

update project_settings
   set judge_model = 'claude-opus-4-6'
 where judge_model in ('claude-opus-4', 'claude-opus-4-20250514');
