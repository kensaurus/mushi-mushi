-- Migration: tester_submissions content columns
-- PURPOSE: Add tester-authored content fields (title, description) and reviewer
--   workflow fields (reviewer_note, reviewed_at) to tester_submissions.
--   These were omitted from Wave 1 to keep the initial migration lean.

ALTER TABLE public.tester_submissions
  ADD COLUMN IF NOT EXISTS title        text CHECK (length(title) <= 200),
  ADD COLUMN IF NOT EXISTS description  text CHECK (length(description) <= 10000),
  ADD COLUMN IF NOT EXISTS screenshot_url text,
  ADD COLUMN IF NOT EXISTS reviewer_note text CHECK (length(reviewer_note) <= 2000),
  ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz;
