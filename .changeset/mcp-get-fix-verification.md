---
'@mushi-mushi/mcp': minor
---

New read tool `get_fix_verification` (ADR 0035): whether an agent's fix is proven to work on its PR's current commit. It returns each merge check in order (Opus review, CI, a test that fails without the fix and passes with it, no weakened tests, size, a second model family's review) with what to do when one is not passing, whether Mushi merged it on its own, and any regression after the merge with its revert PR. Its result is wrapped as untrusted data, since the second review's text is model output from the report and the agent's diff.
