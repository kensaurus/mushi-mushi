# 0063. New MCP installs get the `vibe` tool set; existing configs keep theirs

Status: Accepted 2026-11-14 by the owner (delegated to the lead). Date: 2026-11-14

Related: `packages/mcp/src/feature-groups.ts` (`PRESET_TOOLS.vibe`,
`DEFAULT_FEATURE_GROUPS`), `packages/mcp/src/clients.ts`
(`NEW_INSTALL_FEATURES`), `packages/cli/src/mcp-config.ts`,
`apps/admin/src/lib/cursorDeeplink.ts`, `glama.json`,
`packages/mcp/scripts/generate-glama-json.mjs`,
`scripts/check-catalog-count.mjs`, docs `quickstart/mcp` (#tool-sets).

## Context

- With no `?features=` (hosted) or `MUSHI_FEATURES` (stdio), the server
  exposes `DEFAULT_FEATURE_GROUPS` (triage, fixes, inventory, setup, docs),
  which is 89 tools. `features=all` is 133.
- Glama scored the server 1/5 for tool count ("89 tools is far beyond what an
  agent can hold or select from reliably"). Cursor and chat connectors also
  degrade past about 40 tools.
- The `vibe` preset (12 tools) has shipped since `@mushi-mushi/mcp` 0.30.0. It
  covers the loop the north star promises: the reports, their plain-English
  diagnosis (`get_report_detail`, `triage_next_steps`), the fix brief
  (`get_fix_context`), marking fixed, replying to the reporter, setup checks
  and docs. Lovable's connector already used it.

## Decision

1. **Every new install writes `vibe` explicitly:** the console and docs
   one-click configs (`clients.ts`, `cursorDeeplink.ts`, the OAuth installs),
   `mushi setup --ide`, and the docs commands. "Explicitly" means
   `?features=vibe` in the URL or `MUSHI_FEATURES=vibe` in env, never an
   omitted parameter. That way a later change to the server's default cannot
   move an installed config.
2. **The server's no-parameter default does not change.** Configs written
   before this, which carry no `features`, keep `DEFAULT_FEATURE_GROUPS` and
   their tools.
3. **Opt-ins:** `vibe,fixes` adds dispatching fixes to cloud agents; `all`
   lists every tool. The quickstart documents both.
4. **Directory listings show `vibe`:** `glama.json` lists the preset and
   names both counts, and Glama's own build spec (set in its admin, not in
   the repo Dockerfile) runs with `MUSHI_FEATURES=vibe`.

## Not changed here (follow-ups)

- **The Cursor and Claude plugin bundles** (`packages/cursor-plugin/mcp.json`,
  `plugins/mushi-debugger/.mcp.json`). A plugin update rewrites the config
  for everyone who already installed it, so switching them would silently
  shrink existing users' tool lists. Decide separately: either accept that
  on a release note, or ship it with a visible changelog line.
- **The VS Code extension's `mushiMushi.features` setting** defaults to the
  old groups. Changing a setting default moves every existing user who never
  set it, and the extension releases on its own path
  (`publish-vscode-extension.yml`, not Changesets).

## Rejected

- **Changing the server's default to `vibe`.** It would silently remove
  tools from every existing connection, including agents mid-workflow.
- **`vibe,fixes` as the new-install default.** `dispatch_fix` is the
  cloud-agent path. The north star is the fix ready in the user's own
  editor, which `vibe` covers, and the cloud path stays one opt-in away.
