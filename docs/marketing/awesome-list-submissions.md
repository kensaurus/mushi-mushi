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
- [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) 🏎️ ☁️ - Bug translation for vibe coders: pull a plain-English diagnosis and a paste-ready fix prompt for any user-felt bug, with evidence, blast radius, and fix dispatch — from your AI coding agent. No second LLM key.
```

(Legend: 🏎️ = TypeScript/Node, ☁️ = cloud/remote available. Confirm the repo's
current legend before submitting.)

## 2. awesome-remote-mcp-servers

Repo: <https://github.com/jaw9c/awesome-remote-mcp-servers> (or the fork the
ecosystem currently treats as canonical — verify before PR).

```md
| Mushi Mushi | Bug translation for vibe coders — plain-English diagnosis + paste-ready fix from your editor | OAuth / API key | [docs](https://docs.mushimushi.dev/quickstart/mcp) |
```

(Match the table's actual columns; the row above mirrors the common
name / description / auth / link shape.)

## Checklist

- [ ] `@mushi-mushi/mcp` published to npm and the official MCP registry (auto via release CI).
- [ ] Verify the server appears at `registry.modelcontextprotocol.io` and on Glama / PulseMCP.
- [ ] PR to `punkpeye/awesome-mcp-servers` opened.
- [ ] PR to the canonical `awesome-remote-mcp-servers` opened.
- [ ] README first paragraph is the v2 hero (awesome-list scrapers read it) — enforced by `scripts/check-tagline-consistency.mjs`.
- [ ] `mcp` GitHub topic present (applied by `scripts/marketing/setup-github.mjs`).
