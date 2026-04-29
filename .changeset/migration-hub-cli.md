---
'@mushi-mushi/cli': minor
---

feat(cli): add `mushi migrate` subcommand for guided framework / SDK migrations

Detects the user's stack from `package.json` (and Capacitor/Expo/Cordova
config files) and recommends matching guides from the docs Migration Hub
catalog — Cordova → Capacitor, Capacitor → React Native, CRA → Vite,
Next.js Pages → App Router, Vue 2 → 3, plus the "switch to Mushi" guides
for Instabug, Shake, LogRocket, BugHerd, Pendo, and the SDK-upgrade rail.

Output is a deep link into the docs hub (works on both
`docs.mushimushi.dev` and `kensaur.us/mushi-mushi/docs`) so the user can
land directly on the relevant interactive checklist.

Catalog parity with the docs hub, the admin in-progress card, and the
server's allowlist is enforced as a release gate by
`scripts/check-migration-catalog-sync.mjs` (wired into both `ci.yml`
and `release.yml`), so the four catalogs can never silently drift.

The `mushi-mushi` launcher will bump as a patch via
`updateInternalDependencies: "patch"` in `.changeset/config.json`,
picking up the new CLI dependency.
