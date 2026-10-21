---
'@mushi-mushi/cli': minor
---

Verified merge from the terminal (ADR 0035): an agent's fix merges on its own only with proof.

- `mushi fixes verify <fixId>` shows the gates for the fix PR's current head, each as a mark, a word, a label and what to do: Opus review, CI, a test that fails without the fix and passes with it, no tests weakened, a small change, and a second review. It also shows whether Mushi merged it and any regression after the merge, with the revert PR. `--rerun` re-checks the gates first; `--json` prints the payload.
- `mushi verify workflow` prints the `mushi-verify` GitHub workflow filled in with your project's runner labels and test command, or writes it with `--out .github/workflows/mushi-verify.yml`.
