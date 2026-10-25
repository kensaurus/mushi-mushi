# 0046. Explore mode: a cheap model drives the signed-in app, code judges

Status: Accepted Date: 2026-10-25

Related: ADR [0045](0045-ux-audit-finds-bugs-on-signed-in-screens.md) (UX audit), ADR
[0029](0029-site-watch-files-a-page-only-after-a-second-failure.md) (confirm before filing), ADR
[0039](0039-better-models-make-mushi-better.md) (facts in code, judgement to the model),
`packages/ux/src/explore.ts`, `packages/ux/src/checker.ts`.

## Context

On 2026-10-25 the owner asked why the large unused allowance of a fast model
(Grok through the Cursor CLI) was not used for monkey testing and small
UI/UX checks, beyond fixing filed reports. The UX audit (ADR 0045) only
looks at screens as they first load; bugs that appear after a few ordinary
actions (back after a filter, a double-click, odd input in a search box) are
found only by people. Exploratory agents that also decide what is a bug
report many false positives; a model that only picks the next action is
cheap and gets better as models do.

## Decision

- **`mushi-ux explore --url <live app> --profile-dir <cached profile>`**
  runs a few sessions, one per charter (forms, navigation, stress, filters),
  in the audit's read-only browser: the same cached signed-in profile, the
  same write guard (non-GET requests aborted, form submits cancelled,
  service workers blocked).
- **The model picks actions, never verdicts.** Each step sends the page's
  accessibility snapshot (fenced, marked as data) and the charter to the
  Cursor CLI in read-only ask mode (`--model`, default `grok-4.7-high-fast`, a
  setting). Only a closed set of actions runs (click, fill, select, press
  from a key list, back, forward, reload, scroll, resize); a target whose
  label reads as destructive is refused before the click.
- **Code judges.** A candidate is a console error (framework and guard noise
  filtered), an uncaught page error, a 5xx from the app or a listed API
  host, or a blank page, seen after an action.
- **Confirm before filing.** A candidate is filed only when replaying its
  last steps from a fresh page, without the model, shows the same signal
  again (normalized message). One flaky load is not a bug.
- **Filing** goes through the audit's path (`--file`, ≤15 a run, the 14-day
  ledger and the description marker), kind `explore`, with the start URL and
  every step as repro and a footer that says how it was found.
- **`--review cursor`** on `mushi-ux audit` (and `--checker-via cursor` on
  the loop) uses the same Cursor CLI transport for the screenshot review.

## Rejected

- **Letting the model say what is a bug.** Noisy, and the verdict would not
  improve with evidence; measured signals are filed, the model drives.
- **Free-form model actions (selectors, scripts).** A closed action set keeps
  the guard's promises checkable and the replay deterministic.
- **Filing on first sight.** Replays cost seconds; unconfirmed reports cost
  a triage and a fix attempt each.
