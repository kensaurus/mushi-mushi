-- fast-filter now reads project_settings.stage1_model (it always called
-- Haiku 4.5 before). Two projects carried claude-sonnet-4-6 there, a value
-- that never took effect; reading it as-is would silently move their quick
-- check to a pricier model. Reset them to what they actually ran.
update public.project_settings
   set stage1_model = 'claude-haiku-4-5-20251001'
 where stage1_model = 'claude-sonnet-4-6';
