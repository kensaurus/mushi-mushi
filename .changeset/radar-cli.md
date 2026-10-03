---
"@mushi-mushi/cli": minor
---

Add `mushi radar scan` and `mushi radar show`. `scan` finds storage rows deleted with SQL (the files stay in the bucket and keep billing) and, with `--push`, sends Mushi the build settings it checks against the current Google Play and App Store rules. Run it as one extra step in your existing CI job; Mushi never clones your repo. `show` lists every hole check for the project and what it found; a check that never ran says so and is never shown as passing.

Add `mushi recipe init`, `mushi recipe check [--push]` and `mushi recipe show`. `init` writes a starter `mushi.recipe.json` from what the repo shows. `check` validates it and its token files and lists colours that match no design token; `--push` sends the recipe to Mushi from your existing CI job, for repos Mushi has no token for. A rejected push fails the step.

Add `mushi store pull`. It copies the live App Store and Google Play listings into the repo in fastlane's metadata layout, once, using your own store keys on your machine. Nothing is sent to Mushi, and Mushi never holds a key that can publish. After that the listing is changed in a pull request and your own CI publishes it.
