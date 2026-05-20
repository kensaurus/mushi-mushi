-- Normalize legacy SDK report statuses to the canonical admin workflow.
-- Safe to re-run: only touches rows still on legacy values.

UPDATE reports SET status = 'classified'
WHERE status IN ('triaged', 'grouped', 'dispatched');

UPDATE reports SET status = 'fixed'
WHERE status IN ('resolved', 'completed');

UPDATE reports SET status = 'new'
WHERE status IN ('pending', 'submitted');
