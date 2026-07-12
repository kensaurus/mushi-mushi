-- ============================================================
-- Security fix: feature_request_comments anon SELECT exposed PII
--
-- 20260602200000_feature_request_votes.sql granted anon SELECT on
-- feature_request_comments "for the same rationale as votes" (public,
-- unauthenticated board reads), but unlike votes — which only expose
-- aggregate counts and never user_id to anon — comments carry
-- author_email and free-text body directly. Any unauthenticated caller
-- with the anon key could read every commenter's email address via
-- PostgREST. The feature board is served to anon callers exclusively
-- through the edge function (service_role), so no anon table-level
-- access is required.
-- ============================================================

DROP POLICY IF EXISTS "anon_read_frc" ON feature_request_comments;

REVOKE SELECT ON feature_request_comments FROM anon;
