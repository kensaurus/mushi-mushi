# Agent contract

Source: https://kensaur.us/mushi-mushi/docs/concepts/agent-contract

---
title: Agent contract
description: What Mushi expects an agent to read before opening a PR, and what it promises in return.
---

# Agent contract

Mushi exposes its closed loop to AI coding agents through the MCP server.
This page defines the **bidirectional contract**: what the agent should
read and do, and what Mushi commits to in return.

## The evolution loop (what you're plugging into)

```
User reports a bug
  → Mushi captures screenshot + intent + logs
  → classify-report triages severity, category, blast radius
  → fix-worker opens a draft PR (Cursor / Claude Code)
  → qa-story-runner verifies the fix
  → judge-batch scores it
  → lesson library ingests the pattern
  → next agent reads the lesson and doesn't repeat the mistake
```

The loop is **self-reinforcing**. Every PR the agent opens eventually
feeds the lesson library, which makes the next agent's fix smarter.

## What the agent reads before opening a PR

These are the minimum reads. Agents that skip them produce fixes with
higher recurrence rates (tracked by `judge_batch.recurrence_score`).

| Step | MCP call | Why |
|------|----------|-----|
| Get the fix brief | `get_fix_context(reportId)` | Root cause, smallest file set, repro steps, blast-radius warnings |
| Check lessons | `lessons.query` or read `.mushi/lessons.json` | Anti-patterns from past fixes on similar components |
| Inspect blast radius | `get_blast_radius(componentId)` | Other components that will break if this one changes |
| Read privacy posture | `privacy://status` resource | Confirm whether client data leaves the project LLM account |

  Run `mushi setup --ide cursor --with-rules` to write a `.cursorrules`
  file that embeds these steps as persistent agent instructions.

## What the agent does after merging the PR

| Step | MCP call | What it triggers |
|------|----------|-----------------|
| Record the outcome | `submit_fix_result(fixId, branch, prUrl, files, lines)` | Judge batch queues the fix for scoring |
| (Optional) trigger judge now | `trigger_judge(fixId)` | Runs Sonnet-as-Judge immediately instead of waiting for nightly batch |

## What Mushi commits to in return

When an agent follows this contract, Mushi promises:

1. **A judge score within 24 hours** — `judge_results` row with
   `correctness`, `safety`, `blast_radius`, `test_coverage`, and a
   `recommendation` (ship / iterate / dismiss).
2. **Lesson induction** — if the fix addresses a pattern seen 3+ times,
   the lesson library gains a new rule. The rule appears in the next
   `mushi sync-lessons` output.
3. **Prompt-version credit** — if the fix scores `recommendation=ship`,
   the prompt version that generated it is promoted as a candidate in the
   prompt lab. The lesson library bias shifts toward that prompt's framing.
4. **Evolution history** — the event is visible in `evolution://history`
   so future agents can see the loop converging.

## Self-bootstrap (Claude Code and similar)

Repo setup is a CLI command, not an MCP tool. An agent working in a repo
without Mushi configured runs it in the terminal:

```bash
npx mushi-mushi setup --ide claude --with-rules   # Claude Code
npx mushi-mushi setup --ide cursor --with-rules   # Cursor
npx mushi-mushi sync-lessons                      # current project lessons
```

This writes:
- `.mcp.json` (Claude Code) or `.cursor/mcp.json` (Cursor) — the Mushi MCP
  server entry. For these two clients it is the hosted server URL: the IDE
  opens a browser sign-in on first use and stores the key itself, so no key
  lands in the repo. `--stdio` (or its alias `--ci`) writes a local stdio
  entry instead, which reads the key from the saved CLI config.
- `.claude/rules/mushi.md` (Claude Code) or `.cursorrules` (Cursor), from
  `--with-rules` — the evolution-loop coding rules.
- `.mushi/lessons.json`, from `sync-lessons` — the project's promoted lessons.

If the CLI has no saved credentials, `setup` runs browser sign-in first,
which needs a person at the keyboard; `--dry-run` prints what it would write
without signing in or writing anything. `sync-lessons` needs a signed-in CLI
(or `MUSHI_API_KEY` and `MUSHI_PROJECT_ID` in the environment). Older MCP
server versions list a `setup_repo_for_mushi` tool: it never worked, since
the route it called did not exist, and it has been removed. Use
`mushi setup`.

## Privacy contract

Before dispatching a fix that touches user data fields, read
`privacy://status`. The response tells you:

| Field | What it means |
|-------|---------------|
| `byok_configured` | `true` = your LLM key; `false` = platform key (data transits Mushi's account) |
| `storage_provider` | Where screenshots and logs are stored |
| `retention_days` | How long raw report data is kept |
| `region` | Data residency region |

If `byok_configured = false` and the fix touches PII fields, consider
configuring BYOK first (Settings → API Keys → BYOK) so all LLM calls run
against your own account.

## Scopes

| Scope | What it grants |
|-------|---------------|
| `mcp:read` | All read tools and resources including `privacy://status`, `evolution://history` |
| `mcp:write` | Everything in `mcp:read` plus `submit_fix_result`, `dispatch_fix` |

Mint keys in Admin console → Settings → API Keys. Pick the smallest scope
that works — `mcp:read` is enough for agents that only read context.
