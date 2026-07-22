# Agent skills

Source: https://kensaur.us/mushi-mushi/docs/sdks/skills

---
title: Agent skills
description: Install Mushi playbooks into Cursor and Claude Code, sync them into the console catalog, and attach skill chains to bug reports.
---

# Agent skills

**Skills** are SKILL.md playbooks your AI coding agent reads on demand — bug triage, fix-and-ship, QA sweeps, security audits, and more. Mushi syncs compatible repos into a project catalog and recommends the best skill when a report is classified.

## Install skills into your editor

From the public [Connect page](/connect), pick **Skills** and run:

```bash
npx skills add kensaurus/cursor-kenji
```

That adds playbooks such as `mushi-health`, `mushi-integration`, and `workflow-fix-and-ship` to your local agent.

## How skills connect to Mushi

```
GitHub repo (SKILL.md files)
  → skill-sync edge function (daily + manual)
  → agent_skills catalog in your project
  → classify-report recommends skills per bug
  → Skill Pipelines page runs a chain against a report
```

## Console & MCP

| Surface | What to read |
|---------|----------------|
| [Skill Pipelines (admin)](/admin/skill-pipelines) | Catalog, live pipeline runs, skill sources |
| [MCP server](/sdks/mcp) | `list_skills`, `start_skill_pipeline`, `checkin_pipeline_step` |
| [Connect hub](/connect) | One-click skills install lane |

## Related

- [Skill Pipelines operator guide](/admin/skill-pipelines) — handoff vs cloud execution
- [MCP tools reference](/sdks/mcp-tools.generated) — full tool catalog
- [Incident loop](/quickstart/incident-loop) — start here if prod is broken right now
