---
"@mushi-mushi/cli": minor
---

`mushi work --agent claude` fixes reports with Claude Code (`claude -p`) on the claude.ai plan it is signed in to, instead of the Cursor CLI. The prompt goes on stdin; only the repo's own Claude Code settings load, and no MCP server. Follow-ups (`--followups`) and the local worker take it too: `mushi worker install --agent claude` stores `"agent": "claude"` in `worker.json`, and its lanes run Claude Code for fixes, conflicts and audits. When the agent's plan is out of usage or signed out, `mushi work` stops the batch and the worker holds every lane for 30 minutes; the run is closed as a machine failure, so the report gets no 7-day cooldown. The agent's git also gets an empty credential-helper list, so Git for Windows' credential manager cannot hand it a stored GitHub login.
