---
'@mushi-mushi/cli': minor
---

Add `mushi runner bill`: what GitHub actually charged for Actions this month, per repo, read from GitHub's billing API with your own `gh` login (or `GITHUB_TOKEN`). `--month 2026-09` reads another month, `--owner` another account or organization, and `--push` uploads the month so the console's CI page shows the real bill when the project's token cannot read billing. The token stays on your machine, and Copilot usage is left out.
