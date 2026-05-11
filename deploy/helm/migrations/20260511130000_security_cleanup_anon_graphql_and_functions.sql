-- FILE: 20260511130000_security_cleanup_anon_graphql_and_functions.sql
--
-- Closes all remaining Supabase security-advisor WARNs in two groups:
--
-- GROUP 1 — anon_security_definer_function_executable (residual)
--   The earlier 20260511120500_revoke_anon_security_definer.sql migration
--   covered most functions, but three were missed:
--     • project_members_autoadd_owner()  — trigger function
--     • report_comments_fanout_to_reporter() — trigger function
--     • sync_project_api_key_owner()     — trigger function
--   And match_fix_corpus failed because the `vector` type lives in the
--   `extensions` schema, which is not in the default search_path when
--   REVOKE is executed. This migration sets the correct search_path.
--   Note: revoking EXECUTE on trigger functions does not break the triggers;
--   PostgreSQL bypasses EXECUTE checks for trigger invocations.
--
-- GROUP 2 — pg_graphql_anon_table_exposed (88 tables / views)
--   All public tables were granted SELECT to PUBLIC (Postgres default) at
--   creation. This exposes them in pg_graphql's schema for the `anon` role.
--   Since RLS is enabled and every table's anon-accessible rows are already
--   zero (all policies require auth.uid() or auth.role() = 'service_role'),
--   the actual data exposure is nil — but the advisor still flags the schema
--   pollution. All data access goes through authenticated edge functions;
--   no anonymous client reads these tables directly.
--
--   Exceptions intentionally kept with anon SELECT (these tables have
--   intentional public-read RLS policies):
--     • invitations — accept_invitation() SECURITY DEFINER handles the
--       read; we keep the SELECT grant because the public PostgREST path
--       uses it for token validation before the function is called.
--
--   pg_net schema: cannot be moved — Supabase's pg_net build rejects
--   ALTER EXTENSION pg_net SET SCHEMA with 0A000. This WARN is expected
--   and is documented in 20260418005800_extensions_out_of_public.sql.

-- ── 1. Remaining anon SECURITY DEFINER function REVOKEs ──────────────────────

-- Set search_path so `vector` resolves to extensions.vector for match_fix_corpus.
SET search_path = public, extensions;

REVOKE EXECUTE ON FUNCTION public.match_fix_corpus(vector, uuid, integer)                        FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_snapshot_drift(uuid)                                 FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_upsert_edge(uuid, uuid, uuid, uuid, text, double precision) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mushi_age_upsert_node(uuid, uuid, text, text)                  FROM anon;
REVOKE EXECUTE ON FUNCTION public.project_members_autoadd_owner()                                FROM anon;
REVOKE EXECUTE ON FUNCTION public.report_comments_fanout_to_reporter()                           FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_project_api_key_owner()                                   FROM anon;

RESET search_path;

-- ── 2. Revoke anon SELECT on all tables that should not appear in GraphQL ─────

REVOKE SELECT ON public.a2a_push_deliveries            FROM anon;
REVOKE SELECT ON public.admin_chart_events             FROM anon;
REVOKE SELECT ON public.age_drift_audit                FROM anon;
REVOKE SELECT ON public.anti_gaming_events             FROM anon;
REVOKE SELECT ON public.ask_mushi_messages             FROM anon;
REVOKE SELECT ON public.audit_logs                     FROM anon;
REVOKE SELECT ON public.billing_customers              FROM anon;
REVOKE SELECT ON public.billing_subscriptions          FROM anon;
REVOKE SELECT ON public.bug_ontology                   FROM anon;
REVOKE SELECT ON public.byok_audit_log                 FROM anon;
REVOKE SELECT ON public.classification_evaluations     FROM anon;
REVOKE SELECT ON public.cron_runs                      FROM anon;
REVOKE SELECT ON public.data_subject_requests          FROM anon;
REVOKE SELECT ON public.discovery_events               FROM anon;
REVOKE SELECT ON public.discovery_observed_inventory   FROM anon;
REVOKE SELECT ON public.enterprise_sso_configs         FROM anon;
REVOKE SELECT ON public.fine_tuning_jobs               FROM anon;
REVOKE SELECT ON public.firecrawl_cache                FROM anon;
REVOKE SELECT ON public.fix_attempts                   FROM anon;
REVOKE SELECT ON public.fix_coordination_summary       FROM anon;
REVOKE SELECT ON public.fix_coordinations              FROM anon;
REVOKE SELECT ON public.fix_corpus                     FROM anon;
REVOKE SELECT ON public.fix_dispatch_jobs              FROM anon;
REVOKE SELECT ON public.fix_events                     FROM anon;
REVOKE SELECT ON public.fix_sandbox_events             FROM anon;
REVOKE SELECT ON public.fix_sandbox_runs               FROM anon;
REVOKE SELECT ON public.fix_verifications              FROM anon;
REVOKE SELECT ON public.gate_findings                  FROM anon;
REVOKE SELECT ON public.gate_runs                      FROM anon;
REVOKE SELECT ON public.graph_edges                    FROM anon;
REVOKE SELECT ON public.graph_nodes                    FROM anon;
REVOKE SELECT ON public.integration_health_history     FROM anon;
REVOKE SELECT ON public.intelligence_generation_jobs   FROM anon;
REVOKE SELECT ON public.intelligence_reports           FROM anon;
REVOKE SELECT ON public.inventories                    FROM anon;
REVOKE SELECT ON public.inventory_proposals            FROM anon;
REVOKE SELECT ON public.llm_invocations                FROM anon;
REVOKE SELECT ON public.modernization_findings         FROM anon;
REVOKE SELECT ON public.mushi_runtime_config           FROM anon;
REVOKE SELECT ON public.nl_query_history               FROM anon;
REVOKE SELECT ON public.nl_query_rate_limits           FROM anon;
REVOKE SELECT ON public.organization_members           FROM anon;
REVOKE SELECT ON public.organizations                  FROM anon;
REVOKE SELECT ON public.plugin_dispatch_log            FROM anon;
REVOKE SELECT ON public.plugin_marketplace             FROM anon;
REVOKE SELECT ON public.plugin_registry                FROM anon;
REVOKE SELECT ON public.plugin_submissions             FROM anon;
REVOKE SELECT ON public.pricing_plans                  FROM anon;
REVOKE SELECT ON public.processing_queue               FROM anon;
REVOKE SELECT ON public.project_api_keys               FROM anon;
REVOKE SELECT ON public.project_codebase_files         FROM anon;
REVOKE SELECT ON public.project_integrations           FROM anon;
REVOKE SELECT ON public.project_members                FROM anon;
REVOKE SELECT ON public.project_plugins                FROM anon;
REVOKE SELECT ON public.project_repos                  FROM anon;
REVOKE SELECT ON public.project_retention_policies     FROM anon;
REVOKE SELECT ON public.project_settings               FROM anon;
REVOKE SELECT ON public.project_storage_settings       FROM anon;
REVOKE SELECT ON public.projects                       FROM anon;
REVOKE SELECT ON public.prompt_versions                FROM anon;
REVOKE SELECT ON public.region_routing                 FROM anon;
REVOKE SELECT ON public.report_bulk_mutations          FROM anon;
REVOKE SELECT ON public.report_comments                FROM anon;
REVOKE SELECT ON public.report_embeddings              FROM anon;
REVOKE SELECT ON public.report_external_issues         FROM anon;
REVOKE SELECT ON public.report_groups                  FROM anon;
REVOKE SELECT ON public.report_presence                FROM anon;
REVOKE SELECT ON public.reporter_devices               FROM anon;
REVOKE SELECT ON public.reporter_notifications         FROM anon;
REVOKE SELECT ON public.reporter_reputation            FROM anon;
REVOKE SELECT ON public.reports                        FROM anon;
REVOKE SELECT ON public.request_idempotency            FROM anon;
REVOKE SELECT ON public.research_sessions              FROM anon;
REVOKE SELECT ON public.research_snippets              FROM anon;
REVOKE SELECT ON public.scoped_rate_limits             FROM anon;
REVOKE SELECT ON public.sdk_versions                   FROM anon;
REVOKE SELECT ON public.sentinel_verdicts              FROM anon;
REVOKE SELECT ON public.soc2_evidence                  FROM anon;
REVOKE SELECT ON public.sso_state                      FROM anon;
REVOKE SELECT ON public.status_history                 FROM anon;
REVOKE SELECT ON public.stripe_processed_events        FROM anon;
REVOKE SELECT ON public.support_tickets                FROM anon;
REVOKE SELECT ON public.synthetic_reports              FROM anon;
REVOKE SELECT ON public.synthetic_runs                 FROM anon;
REVOKE SELECT ON public.usage_events                   FROM anon;
REVOKE SELECT ON public.webhook_audit_log              FROM anon;
