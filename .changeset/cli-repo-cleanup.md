---
'@mushi-mushi/cli': minor
---

Add `mushi repo cleanup show|request|restore`: see which branches and fix pull requests Mushi opened can go (a branch whose pull request merged or closed and that still points at its last commit; a fix PR replaced by a newer one, held by the Opus review, or without new commits for 14 days), each with its reason and commit, and ask for a clean-up or for deleted branches to come back. Nothing changes on GitHub until a team owner or admin approves the exact list in the console (Repo → Clean up), where Mushi checks every item again before it deletes or closes anything.
