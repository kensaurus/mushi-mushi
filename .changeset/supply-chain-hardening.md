---
"@mushi-mushi/cli": patch
"mushi-mushi": patch
---

- **Supply-chain hardening** workspace-wide 7-day cooldown on new dep
  versions (pnpm `minimumReleaseAge` + npm `min-release-age` + Dependabot
  `cooldown`), plus PR-time `dependency-review-action`, post-publish
  `npm audit signatures`, `strictDepBuilds`, and `blockExoticSubdeps`.
  Closes the window real-world npm attacks operate in (Axios 1.14.x: ~5h to
  detection; Shai-Hulud worm: ~12h) — every publicly-disclosed 2025–2026
  npm supply-chain attack would have been blocked by these defaults.
- **Launcher README** adds a Socket.dev badge and a new "Supply-chain &
  verification" section that explains, up front, what each external scanner
  reports about `mushi-mushi` (npm provenance, Socket.dev alerts,
  Bundlephobia `EntryPointError`, Snyk Advisor crawler lag) and why none
  of them are actionable bugs.
- **CLI** bumped `@clack/prompts` from `^0.11.0` to `^1.2.0`. v1 widened
  the `text({ validate })` callback parameter to `string | undefined`; the
  `requireSecret()` helper was updated to handle the new signature
  explicitly. No user-visible change; the v1 spinner-API breaking change
  isn't used here.

Repo settings (no code change): GitHub Discussions and Dependabot security
updates were enabled via `gh api`.
