# Outline: dev.to article, "What a tool-quality score taught us about our MCP server"

**Status:** outline only. Write it after the numbers below are re-checked.
**Where:** dev.to (with the AI-assistance note dev.to asks for). Not the
personal Zenn feed (PLAN.md "Stop doing" #6). A Japanese version can go on Qiita
later.
**Tag:** `devto.toolcatalog` (`links.md`). Links go to `/docs/connect` and
`/docs/demo/diagnosis`, never straight to the console.
**Audience:** people who build or install MCP servers and wonder why their
agent picks the wrong tool.

## Why this angle

The data story (`01`) already covers "users don't report bugs". This article is
for MCP builders instead: a concrete, checkable lesson from our own server, with
the score that exposed it. It needs no install or revenue numbers, so it can
go out before the Show HN gates hold.

## Outline

1. **The problem in one paragraph.** An agent with a long tool list picks a
   near-neighbour: `get_fix_context` when it wanted `suggest_fix`, a list call
   when it wanted a search call. Each wrong pick costs a round trip and
   sometimes a wrong answer.
2. **What the score said.** Glama scores each listed server's tool definitions
   (TDQS, https://tdqs.dev/). Ours, scored 2026-10-31: **A, 3.7 of 5 across 86
   tools, disambiguation 3 of 5**, with the note that "the set has many
   near-neighbors". Quote it exactly and screenshot the panel.
   `[verify on the day: the score is re-run, the tool count changes]`
3. **What we changed.**
   - The default catalog is lean. With no `MUSHI_FEATURES` (stdio) or
     `?features=` (hosted), only `DEFAULT_FEATURE_GROUPS` load: `triage`,
     `fixes`, `inventory`, `setup` and `docs` (`packages/mcp/src/feature-groups.ts`).
     The other groups (`qa`, `skills`, `codebase`, `admin`, `usage`) turn on
     with `features=all` (the catalog's own hint, `packages/mcp/src/catalog.ts`).
   - `use_mushi` lists the tools for an intent, so the agent can ask instead
     of guessing.
   - Show one before and after tool description, from git history, where a
     description now says when not to use the tool.
   - `[verify: lean default tool count, from the built catalog]`
4. **How we keep the public list honest.** `glama.json` is generated from
   the catalog (`packages/mcp/scripts/generate-glama-json.mjs --check`). Admit
   the gap we found while writing: on 2026-11-13 `glama.json` listed 92 tools
   while its description, and the docs, said 130. Show the fix commit.
   `[blocked: reconcile the 92 vs 130 count first]`
5. **What we'd tell another MCP builder.** Three rules, each with its
   example from steps 3–4. No rule without an example.
6. **Close.** One line on what Mushi Mushi is: a bug report turned into a
   plain-English cause and a fix prompt your editor pulls over MCP. Link the
   sample diagnosis and `/docs/connect`.

## Images

- The TDQS panel from the Glama listing (screenshot on the day).
- The sample diagnosis card: `img/ph-gallery-2-diagnosis.png`.
- Optional cover: `img/ph-gallery-1-field-kenji.jpg`.

## Kill switch

Under 20 tagged views (`devto.toolcatalog`) after 14 days: no follow-up
technical post on dev.to this quarter.
