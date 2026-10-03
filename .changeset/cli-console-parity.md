---
"@mushi-mushi/cli": minor
---

Bring the console's newer pages to the terminal.

- `mushi portfolio show|findings|resources`: every app in your team on one screen, the problems repeated across them, and the domains, accounts and buckets they share.
- `mushi audit findings` and `mushi audit explain <id>`: each gate finding with file and line, and why one fired and how to fix it. `--gate` passes any gate name to the server, so a new server-side gate works before a CLI release. Plain `mushi audit` still runs the summary audit, now prints the server's error message whatever its shape, and ends by pointing at `mushi audit findings`.
- `mushi repo digest`: one token-budgeted text of the connected repo for an LLM, optionally starting from a report's files. `mushi repo diagram show|generate|publish|unpublish` manages the architecture diagram; publishing shows the preview first and needs `--yes`.
- `mushi connectors list|status|actions`: the team's connectors with their status and last error, and the actions requested on them. This is read-only; connectors are still added in the console.
- `mushi funnel show|set|growth`: one funnel across every app, and the operator growth funnel.
- `mushi code-health show|stats`: oversized files and bundle size from your CI.
- `mushi releases list|stats|show|draft|edit|delete|publish|calendar`: release notes that credit reporters. `publish` messages them, so it needs `--yes`.
- `mushi sentry import`: pull Sentry issues that are already open into the queue, by id or by search, with paging.
- `mushi outbox list|edit|release|discard`: reporter updates held for review. Release and discard need `--yes`.
- `mushi budgets show|autofix`: the monthly AI budget, the auto-fix caps, the plan spend cap and the auto-fix switch in one view.

Team-wide commands need an account-level key. When you belong to several organizations, the error lists them with the `--org` value to pass. Slow routes (diagram, release draft, Sentry import, digest) now get a longer timeout. Older routes that answered a bare error string now print that message instead of `undefined`.
