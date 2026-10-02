---
"@mushi-mushi/cli": minor
---

Add `mushi radar scan` and `mushi radar show`. `scan` finds storage rows deleted with SQL (the files stay in the bucket and keep billing) and, with `--push`, sends Mushi the build settings it checks against the current Google Play and App Store rules. Run it as one extra step in your existing CI job; Mushi never clones your repo. `show` lists every hole check for the project and what it found; a check that never ran says so and is never shown as passing.
