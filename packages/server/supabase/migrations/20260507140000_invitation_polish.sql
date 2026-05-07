-- ============================================================
-- Invitations v1.2 — production polish.
--
-- Three additive columns that unlock the next round of UX work
-- without forcing another migration when each one ships:
--
--   1. `note` — the optional personal message the inviter writes in
--      the admin Members form. Surfaces in both the invite email
--      (`{{ .Data.note }}` in the Supabase template) and the new
--      preview-before-accept screen. NN/g + every B2B SaaS we
--      benchmarked (Linear, Vercel, Notion) shows that a personal
--      note moves invitation acceptance rates measurably; without
--      this column the invitee sees a generic boilerplate email and
--      has to guess context.
--
--   2. `resend_count` — the v1.1 migration added `last_resent_at`
--      but we never actually shipped the resend route. To distinguish
--      "operator hit Resend twice" from "operator hit Resend ten
--      times because the invitee's spam filter is broken" we need a
--      counter, not just a most-recent timestamp. NOT NULL DEFAULT 0
--      so existing rows materialise without a backfill pass.
--
--   3. `last_seen_at` — stamped the first time the invitee opens the
--      preview endpoint with their token. Lets the operator see
--      "Opened 2h ago, never accepted" and decide whether to nudge,
--      vs "Never opened" which usually means a deliverability
--      problem (spam folder, wrong address) the inviter can fix
--      with a Resend or a Copy-link fallback.
--
-- 280-char cap on `note` matches Twitter's classic short-form
-- ceiling — long enough for context, short enough to fit cleanly
-- into the email body and the preview screen without scroll. We
-- enforce it as a CHECK so a bad client can't inject a 100k blob
-- into every team's inbox.
-- ============================================================

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS note          text,
  ADD COLUMN IF NOT EXISTS resend_count  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_seen_at  timestamptz;

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_note_length_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_note_length_check
  CHECK (note IS NULL OR char_length(note) <= 280);

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_resend_count_nonneg_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_resend_count_nonneg_check
  CHECK (resend_count >= 0);

-- A resend_count > 0 implies last_resent_at IS NOT NULL — they're
-- tightly coupled and the route bumps both atomically. The CHECK is
-- one-way (count > 0 ⇒ stamp present) because the original send
-- counts as the "0th" event, not a resend.
ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_resend_pair_check;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_resend_pair_check
  CHECK (resend_count = 0 OR last_resent_at IS NOT NULL);

COMMENT ON COLUMN public.invitations.note IS
  'Optional 280-char personal message from the inviter. Rendered as plain text in both the invite email body and the preview-before-accept screen. NULL means no note was provided.';
COMMENT ON COLUMN public.invitations.resend_count IS
  'Number of times the invite has been re-emailed via POST /v1/org/:id/invitations/:id/resend. The original send is "0", first resend is "1". Bumped atomically with last_resent_at.';
COMMENT ON COLUMN public.invitations.last_seen_at IS
  'First time the invitee opened the invite link (GET /v1/invitations/preview?token=...). Distinguishes "ignored / spam-filtered" from "opened but did not accept" so the operator can decide whether a resend or a fresh send is the right escalation.';
