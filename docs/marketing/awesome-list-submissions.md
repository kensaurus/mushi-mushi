# Awesome-list submissions (MCP distribution)

Per the 2026 MCP registry playbook: publish to the **official registry first**
(`registry.modelcontextprotocol.io`) — release CI does this automatically when
`@mushi-mushi/mcp` ships (see `.github/workflows/release.yml` → "Publish MCP
server to the official registry"). Glama and PulseMCP auto-index from the
registry. Then open PRs to the curated awesome-lists below.

Manifest: [`packages/mcp/server.json`](../../packages/mcp/server.json) ·
registry name: `io.github.kensaurus/mushi-mushi`.

## 1. punkpeye/awesome-mcp-servers

Repo: <https://github.com/punkpeye/awesome-mcp-servers>

Add under the relevant category (Developer Tools / Monitoring). Ready-to-paste
entry (alphabetical insertion — match surrounding format):

```md
- [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) 🏎️ ☁️ - Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key.
```

(Legend: 🏎️ = TypeScript/Node, ☁️ = cloud/remote available. Confirm the repo's
current legend before submitting.)

## 2. awesome-remote-mcp-servers

Repo: <https://github.com/jaw9c/awesome-remote-mcp-servers>

PR [#428](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/428) was **closed**
because the MCP endpoint used a non-resolving hostname. Re-submitted as
[#431](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/431) with the Supabase
Streamable HTTP URL below (matches `packages/mcp/server.json` `remotes`).

```md
| Mushi Mushi | Debugging / Monitoring | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs` | API Key | [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) |
```

Re-open via:

```bash
node scripts/marketing/propose-awesome-pr.mjs \
  --upstream jaw9c/awesome-remote-mcp-servers \
  --section "## Remote MCP Server List" \
  --entry "| Mushi Mushi | Debugging / Monitoring | \`https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs\` | API Key | [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) |" \
  --branch add-mushi-mushi-mcp \
  --pr-title "Add Mushi Mushi remote MCP server" \
  --pr-body "Replaces closed #428 — previous row used a hostname that does not resolve. Hosted Streamable HTTP MCP on Supabase; API key auth. Live demo: https://kensaur.us/mushi-mushi/"
```

(Verify the README section heading before running — adjust `--section` if the table moved.)

## 3. Directories and lists — issue-first, one per week (added 2026-09-21)

Third-party mentions earn far more AI-answer citations than owned pages, so
these are worth a slow, polite drip: **one per week, issue first** (or the
directory's own submit form), no parallel PRs, bump once after five business
days, then let it go. Track the state here; the Monday ritual in
[`drip-channels.md`](./drip-channels.md) checks this table.

| # | Where | Entry / category | Prerequisite | Status |
|---|---|---|---|---|
| 1 | [OpenAlternative](https://openalternative.co/) — submit as an open-source alternative to Sentry and Jam | "Mushi Mushi — open-source bug reports with a plain-English diagnosis and a fix prompt in Cursor / Claude Code. MIT SDKs, AGPLv3 server." | Demo gate passed (they click it) | issue-first: not submitted |
| 2 | [LibHunt](https://www.libhunt.com/) — JavaScript / DevOps | Same entry; link the npm package `@mushi-mushi/react` and the repo | none | issue-first: not submitted |
| 3 | [StackShare](https://stackshare.io/) — tool page under Monitoring / Bug tracking | Same entry; logo from `docs/mascot/mushi-happy.png` | none | issue-first: not submitted |
| 4 | [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) — Analytics / Error tracking (main list; AGPLv3 qualifies) | `- [Mushi Mushi](https://kensaur.us/mushi-mushi/) - In-app bug reports that arrive with a plain-English diagnosis and a paste-ready fix for Cursor / Claude Code. ([Demo](https://kensaur.us/mushi-mushi/docs/connect), [Source Code](https://github.com/kensaurus/mushi-mushi)) \`AGPL-3.0\` \`Docker\`` | **Demo gate passed** (the list requires a working demo or screenshots) | issue-first: not submitted |
| 5 | [awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) — Integrations / Plugins | List `.claude-plugin/marketplace.json` and `plugins/mushi-debugger/` (the subagent that pulls a user's report + fix context into Claude Code) | `scripts/check-cursor-plugin.mjs` green; plugin README current | issue-first: not submitted |
| 6 | [awesome-remote-mcp-servers #431](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/431) | Already open (see §2) | none | nudged 2026-09-22, then stop |

Submit-form paths and category names were not verified on 2026-09-21; check
each site's current submission flow before opening anything.

## Checklist

- [x] `@mushi-mushi/mcp` published to npm and the official MCP registry (auto via release CI).
- [ ] One entry from §3 opened per week, issue-first, status column updated here.
- [ ] Verify registry `websiteUrl` shows `kensaur.us` (live record still has legacy hostname until next npm patch republish — `server.json` is fixed locally).
- [x] PR to `punkpeye/awesome-mcp-servers` opened ([#8625](https://github.com/punkpeye/awesome-mcp-servers/pull/8625)).
- [x] PR to `awesome-remote-mcp-servers` re-opened ([#431](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/431), supersedes closed #428).
- [ ] README first paragraph is the v2 hero (awesome-list scrapers read it) — enforced by `scripts/check-tagline-consistency.mjs`.
- [ ] `mcp` GitHub topic present (applied by `scripts/marketing/setup-github.mjs`).
