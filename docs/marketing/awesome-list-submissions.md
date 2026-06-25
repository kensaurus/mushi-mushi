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

## Checklist

- [x] `@mushi-mushi/mcp` published to npm and the official MCP registry (auto via release CI).
- [ ] Verify registry `websiteUrl` shows `kensaur.us` (live record still has legacy hostname until next npm patch republish — `server.json` is fixed locally).
- [x] PR to `punkpeye/awesome-mcp-servers` opened ([#8625](https://github.com/punkpeye/awesome-mcp-servers/pull/8625)).
- [x] PR to `awesome-remote-mcp-servers` re-opened ([#431](https://github.com/jaw9c/awesome-remote-mcp-servers/pull/431), supersedes closed #428).
- [ ] README first paragraph is the v2 hero (awesome-list scrapers read it) — enforced by `scripts/check-tagline-consistency.mjs`.
- [ ] `mcp` GitHub topic present (applied by `scripts/marketing/setup-github.mjs`).
