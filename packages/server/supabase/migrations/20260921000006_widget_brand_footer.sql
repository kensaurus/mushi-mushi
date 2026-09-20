-- ============================================================================
-- FILE: 20260921000006_widget_brand_footer.sql
-- PURPOSE: Per-project override for the "Bug reports by Mushi" footer on the
--          feedback widget (growth loop, docs/plan-gtm.md → Workstream C §6).
--
--   NULL  → plan default: on for free_cloud / hobby, off for paid plans
--           (_shared/brand-footer.ts). Self-hosters run paid/enterprise rows
--           or set the MIT `brandFooter` host config, which stays a hard
--           override on the client.
--   true  → always show   · false → never show (one-click opt-out in the
--           console: PATCH /v1/admin/settings { widget_brand_footer } or
--           PUT /v1/admin/projects/:id/sdk-config { widget: { brandFooter } }).
--
-- Served to the SDK as widget.brandFooter by GET /v1/sdk/config.
-- ============================================================================

alter table public.project_settings
  add column if not exists widget_brand_footer boolean;

comment on column public.project_settings.widget_brand_footer is
  'Powered-by-Mushi footer on the feedback widget. NULL = plan default (on for free_cloud/hobby, off for paid). Emitted as widget.brandFooter by GET /v1/sdk/config; the host''s MIT brandFooter config remains a hard override.';

notify pgrst, 'reload schema';
