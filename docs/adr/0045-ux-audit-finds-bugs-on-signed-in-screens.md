# 0045. UX audit: Mushi finds UI bugs on signed-in screens with a cached session

Status: Accepted Date: 2026-10-24

Related: ADR [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) (local UX loop), ADR
[0021](0021-a-second-model-may-veto-a-kept-ux-step.md) (checker transports), ADR
[0039](0039-better-models-make-mushi-better.md) (facts in code, judgement to the model),
`packages/ux/src/audit.ts`, `packages/ux/src/profile.ts`.

## Context

On 2026-10-24 the owner asked why the console's own UI bugs (numbers that
disagree across pages, a modal that left the sidebar bright, a phone layout
that scrolled sideways) were found by an agent walking the console by hand,
not by Mushi. Mushi watches public pages (site watch, site audit, user-story
tests) but nothing looks at screens behind a sign-in, and the UX loop
(`mushi-ux run`, ADR 0020) works on a local dev server: it needs its own
sign-in to a fresh browser. The owner then ruled that every agent on this
machine reuses a cached, signed-in browser profile and never opens a fresh,
uncached session (`~/.claude/rules/visual-qa-signed-in-browser.md`).

## Decision

- **`mushi-ux audit --url <live app> --profile-dir <cached profile>`** maps
  the screens under the URL's path (`scopePath`: a console that shares its
  origin with docs stays inside its own path), behind the write guard
  (read-only), and captures each at 1440x900 and 390x844.
- **Session:** `--profile-dir` reuses an existing persistent profile (for
  example `~/.playwright-cli-profiles/<app>`), opened with the installed
  Chrome (`--channel chrome`, the default for such a profile). A signed-out
  profile stops the run with "sign the cached profile in once"; the tool
  never opens a sign-in window or types credentials. The path is never shown
  to an agent.
- **Facts first:** findings come from measurements: serious and critical axe
  rules, a page that scrolls sideways, console errors, layout shift past
  0.1. An optional model review (`--review claude-code|anthropic-api`, the
  checker's transports, the judge model setting) of whole pages adds only
  concrete visual defects with an element and a "Done when"; taste notes
  are dropped.
- **Filing (`--file`):** one Mushi report per (screen, kind, rule) through
  the same route as `mushi reports file`, at most 15 a run, deduped by a
  fingerprint: a ledger on the machine (14 days) and a marker in the report
  description that the reports search finds while an open report has it.
  `--dry-run` files nothing. The reports then go through triage and the fix
  loop like any other.
- Runs are bounded: `--max-pages` (15) and `--max-screens` (30, pages first);
  only pages go to the model.

## Rejected

- **A hosted audit that signs in with stored credentials.** Mushi would hold
  a password for every app; a cached profile on the owner's machine keeps
  the session where it already is.
- **Auditing the local dev server.** It has no session and differs from what
  users see; the live app is the thing to check.
- **A model-only audit.** Vision models are noisy on small UI details
  (ADR 0021); measured facts are filed first, the model only adds defects it
  can point at.

## Consequences

- Any signed-in app with a cached profile can be audited on a schedule
  (BL-120 covers scheduling from the console for every app).
- Findings that need a model review spend the reviewer's model credits; a run
  without `--review` costs nothing but time.
