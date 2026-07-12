/*
FILE: 20260617190000_mcp_tool_invocations.sql
PURPOSE: Persist MCP tool invocation audit trail for admin console + compliance.

OVERVIEW:
- One row per hosted MCP tools/call (stdio logs locally only)
- Args stored as shape fingerprint only — never raw argument values
- Service-role only; reads via /v1/admin/mcp/logs?service=mcp

NOTES:
- Retention: operators may add pg_cron purge later; table is append-only for now.
*/

CREATE TABLE IF NOT EXISTS public.mcp_tool_invocations (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key_id       uuid        REFERENCES public.project_api_keys(id) ON DELETE SET NULL,
  tool_name        text        NOT NULL,
  scope            text,
  transport        text        NOT NULL DEFAULT 'hosted'
                   CONSTRAINT mcp_tool_invocations_transport_check
                     CHECK (transport IN ('hosted', 'stdio')),
  status           text        NOT NULL
                   CONSTRAINT mcp_tool_invocations_status_check
                     CHECK (status IN ('ok', 'error')),
  duration_ms      integer     NOT NULL,
  request_id       text,
  args_fingerprint text,
  error_code       text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_project_created_idx
  ON public.mcp_tool_invocations (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_tool_invocations_tool_created_idx
  ON public.mcp_tool_invocations (tool_name, created_at DESC);

ALTER TABLE public.mcp_tool_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON public.mcp_tool_invocations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON public.mcp_tool_invocations FROM PUBLIC;
GRANT ALL ON public.mcp_tool_invocations TO service_role;
