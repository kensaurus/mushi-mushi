# Mushi Mushi public roadmap

The live, sortable view lives at:

**https://github.com/users/kensaurus/projects/1**

It's a GitHub Projects v2 board with these single-select fields:

| Field   | Values                                                                                       |
| ------- | -------------------------------------------------------------------------------------------- |
| Status  | Backlog · In Progress · In Review · Blocked · Done                                           |
| Phase | A · B · C · D · E |
| Area    | Web SDK · Mobile SDK · Admin · Server · LLM Pipeline · Knowledge Graph · Fix Orchestrator · Plugins · Billing · Docs · Security |
| Impact  | P0 · P1 · P2 · P3                                                                             |
| Type    | Bug · Enhancement · RFC · Docs · Ops                                                          |

## How items get on the board

Every issue and PR opened against `kensaurus/mushi-mushi` is auto-added
by [`auto-add-to-roadmap.yml`](workflows/auto-add-to-roadmap.yml). When
you add a `status:*` label, the workflow also flips the project's
**Status** field to match.

## How to file a roadmap request

1. Open an issue using the **Feature Request** template.
2. Add `phase:?` if you have an opinion on which release train it
   belongs to (we'll re-bucket if needed).
3. Add `area:*` (web-sdk, server, llm-pipeline, …) so it lands in the
   right swim lane.

That's it — the bot handles the rest.

## How to recreate the board

The board is reproducible. If it's ever deleted or you want a fresh
copy in a fork:

```bash
gh auth refresh -s project,read:org
node scripts/bootstrap-roadmap.mjs
```

The script is **idempotent** — re-running it adds missing fields /
options without touching existing ones, and flips the project to
PUBLIC visibility.

## How status flows

```
status:planning  →  Backlog
status:in-flight →  In Progress
status:in-review →  In Review
status:blocked   →  Blocked
status:done      →  Done
```

Adding any of those labels to an issue/PR is mirrored to the project's
**Status** column by `.github/scripts/sync-roadmap-status.mjs`.

## Release plan

See the [whitepaper](../MushiMushi_Whitepaper_V5.md) for the full
architectural target. The high-level shape:

| Phase | Theme | Status |
| ---- | ------------------------------------------------------ | ---------- |
| A    | Vision air-gap, MCP correctness, RAG, sandbox          | Shipped    |
| B    | WASM SLM, real-time collab, AG-UI, fine-tune           | Shipped    |
| C    | Mobile parity, A2A, SOC 2, residency, BYOK             | Shipped    |
| D    | Marketplace, docs, Cloud, multi-repo fixes             | In flight  |
| E    | v1.0.0 GA + whitepaper V6.0                            | Next       |
