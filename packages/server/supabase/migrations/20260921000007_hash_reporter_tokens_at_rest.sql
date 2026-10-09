-- ============================================================
-- Hash reporter tokens at rest in end_user_sessions and product_events.
--
-- The SDK reporter token is a bearer credential: the report-thread routes
-- accept the raw token and hash it to find the end user's reports, so anyone
-- holding it can read that end user's threads and reply as them. The report
-- path has always stored only sha256(token). The session route and the new
-- analytics route stored the raw value the web SDK sends (in a field misnamed
-- `reporter_token_hash`): 26,571 raw credentials in end_user_sessions on
-- 2026-09-21, readable by every member of the owning organization.
--
-- From api deploy of 2026-09-21 both routes hash on write
-- (_shared/reporter-token.ts). This backfill converts the existing rows to
-- the same digest: lowercase hex SHA-256 over the UTF-8 bytes, verified equal
-- to the Deno helper for a multibyte sample before applying. Rows already
-- holding a 64-char hex digest are left alone, so re-running is a no-op.
--
-- Readers only do count(distinct reporter_token_hash)
-- (project_activity_summary, org_portfolio_summary). SHA-256 is one-to-one on
-- these inputs, so every device/DAU count is unchanged; without the backfill a
-- device seen before and after the deploy would count twice.
-- ============================================================

update public.end_user_sessions
set reporter_token_hash = encode(sha256(convert_to(reporter_token_hash, 'UTF8')), 'hex')
where reporter_token_hash is not null
  and reporter_token_hash !~ '^[0-9a-f]{64}$';

update public.product_events
set anon_id = encode(sha256(convert_to(anon_id, 'UTF8')), 'hex')
where anon_id is not null
  and anon_id !~ '^[0-9a-f]{64}$';

comment on column public.end_user_sessions.reporter_token_hash is
  'sha256 hex of the SDK reporter token (never the raw token; see _shared/reporter-token.ts).';
comment on column public.product_events.anon_id is
  'sha256 hex of the SDK reporter token used as the anonymous person key (never the raw token).';
