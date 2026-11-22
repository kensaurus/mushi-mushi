-- ============================================================================
-- A fix claim may end `gone` (2026-11-12).
--
-- mushi work now checks, for free, whether a report is still there before it
-- spends an agent run: a code-audit finding's own deterministic check run
-- again on the base branch, or an `already_fixed` verdict whose commit is on
-- it (packages/cli/src/commands/work-recheck.ts). Such a claim ends `gone`,
-- and the claim route closes the report as fixed with the reason as a team
-- note. The outcome CHECK gains the value; nothing else changes.
-- ============================================================================

ALTER TABLE public.work_claims DROP CONSTRAINT IF EXISTS work_claims_outcome_check;
ALTER TABLE public.work_claims
  ADD CONSTRAINT work_claims_outcome_check CHECK (
    outcome IS NULL OR outcome = ANY (ARRAY[
      'pr_opened', 'no_change', 'verdict', 'timeout', 'skipped', 'stopped', 'failed',
      'lease_expired', 'pushed', 'refused', 'filed', 'ran', 'gone'
    ])
  );
