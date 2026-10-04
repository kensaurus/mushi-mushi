-- Tester profile privacy flags + KYC legal name (console group K #218, #219).
--
-- #218: /tester/settings has two privacy checkboxes ("Show my handle…" and
-- "Include my stats in the 30-day leaderboard") but both wrote
-- mushi_testers.public_leaderboard, so unticking only one did nothing.
-- public_handle_visible gives the handle checkbox its own column.
--
-- public_leaderboard already exists on the hosted database but was never
-- recorded in a migration (schema drift found 2026-10-04); ADD COLUMN IF NOT
-- EXISTS records it without changing hosted data.
--
-- #219: the KYC form requires a legal name (W-9 / W-8BEN) and sends it, but
-- tester_kyc had no column, so it was silently discarded.
--
-- Additive only. Apply BEFORE deploying the `api` edge function that reads
-- and writes these columns.

ALTER TABLE public.mushi_testers
  ADD COLUMN IF NOT EXISTS public_leaderboard boolean NOT NULL DEFAULT true;

ALTER TABLE public.mushi_testers
  ADD COLUMN IF NOT EXISTS public_handle_visible boolean NOT NULL DEFAULT true;

-- Keep today's behaviour for existing testers: until now the handle flag was
-- the same column as the leaderboard flag.
UPDATE public.mushi_testers
   SET public_handle_visible = public_leaderboard
 WHERE public_handle_visible IS DISTINCT FROM public_leaderboard;

COMMENT ON COLUMN public.mushi_testers.public_leaderboard IS
  'Tester opted in to appear with stats on the 30-day leaderboard.';
COMMENT ON COLUMN public.mushi_testers.public_handle_visible IS
  'Tester opted in to show their public_handle on leaderboards and reviewer cards.';

ALTER TABLE public.tester_kyc
  ADD COLUMN IF NOT EXISTS legal_name text
    CHECK (legal_name IS NULL OR length(legal_name) BETWEEN 1 AND 200);

COMMENT ON COLUMN public.tester_kyc.legal_name IS
  'Legal name as written on the W-9 / W-8BEN tax form. Personal data: service-role access only, erased with the tester.';
