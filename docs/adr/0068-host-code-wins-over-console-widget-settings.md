# 0068. Host code wins over the console for every widget setting

Status: Accepted 2026-11-22 by the owner, decided through the team lead.
Date: 2026-11-22

Related: `packages/web/src/runtime-merge.ts` (`mergeRuntimeConfig`),
`packages/web/src/runtime-merge.test.ts`, `docs/SDK_RUNTIME_CONFIG.md`
("Client: merge precedence"), `_shared/sdk-config.ts` (explicit-only emission,
the widget accent), migration `20261122120000_sdk_widget_accent.sql`, MCP
`get_widget_settings` / `set_widget_settings`, CLI `mushi widget show|set`.

## Context

The widget's look can be set in two places: the host app's code
(`Mushi.init({ widget: … })`, or `data-*` attributes on the script tag) and the
console, which serves `GET /v1/sdk/config` to every installed SDK at startup.
The merge rule differed by key:

- the console won for `position`, `theme`, `triggerText` and the banner fields;
- the host won for `brandFooter` and, through special cases, for the launcher
  (`trigger: 'banner' | 'attach' | 'manual'`).

So the same kind of setting behaved two ways, and a developer could not tell
from the code what users would see. User feedback on 2026-11-22 asked for "easy
and robust customization of the widget", like Intercom and Crisp, and this
change adds a brand colour that the console, MCP and the CLI can set. A colour
with a third precedence rule would have made the mix worse.

## Decision

One rule for every widget appearance key: **an explicit value set in the host's
code wins; the console's runtime value fills only what the code left unset;
then the SDK default.**

- It covers `position`, `theme`, `triggerText`, `accent` (with `accentText`,
  which always follows the accent that wins), `screenshotSensitiveHint`,
  `attachToSelector`, `brandFooter`, and each banner field against the host's
  `bannerConfig`, field by field.
- "Set in code" is judged against the bootstrap config (the third argument of
  `mergeRuntimeConfig`), so a cached runtime payload applied on an earlier
  merge never counts as a code value.
- The launcher (`trigger` / `launcher`) keeps its existing rules, which already
  let host-owned triggers win.
- Capture flags (`capture.*`) are not appearance keys and keep their rule: a
  value the console explicitly sends applies.

## Consequences

- Behaviour change in `@mushi-mushi/web` (minor release): an app that sets
  `position`, `theme`, `triggerText` or a banner field in code **and** changes
  it in the console now shows the code's value, where it used to show the
  console's. To let the console decide, remove the option from the code.
- The console, MCP and CLI say so next to these fields ("If your app's code
  sets this, your code's value wins."), and the script-tag snippet says that its
  `data-*` settings win over the console.
- The framework snippets the console generates still bake position, theme and
  trigger text into code when they differ from the defaults, so a pasted
  snippet pins them. The accent is never baked into a framework snippet.
  Whether the snippets should leave every runtime-served key to the console is
  open (follow-up).
- The React Native SDK has its own merge and is not changed here.

## Alternatives rejected

- **Console always wins.** Surprising for developers: a value they can read in
  their own code is silently replaced by a setting elsewhere. Intercom and
  Sentry also let code-level settings win over their dashboards.
- **Keep the per-key mix and add the accent as host-wins.** Leaves three
  behaviours for one kind of setting and no rule a person can state.
