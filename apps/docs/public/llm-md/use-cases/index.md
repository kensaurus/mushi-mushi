# Use cases & comparisons

Source: https://kensaur.us/mushi-mushi/docs/use-cases

---
title: Use cases & comparisons
description: Where Mushi Mushi fits. An open-source Sentry alternative, a debugger for Cursor and Claude Code apps, and an MCP bug-fixing server for your editor.
---

# Use cases & comparisons

Mushi Mushi is bug fixing for AI-built apps: your users tap a button to tell
you what broke, Mushi Mushi checks your live site too, and every bug gets a
plain-English explanation and a fix your AI can apply. These pages map that
onto the situations people actually search for.

**Your situation**

- **[You built your app with Lovable or Bolt](/use-cases/no-code-founder)**:
  a report button, a plain-English cause and fix words to paste back, with no
  terminal.
- **[You build apps for clients](/use-cases/agency-client-apps)**: one report
  button per client app and one console for all of them.
- **[You have a phone app](/use-cases/mobile-app)**: shake to report, for
  Expo, React Native and Capacitor.
- **[Your Lovable app broke in production](/use-cases/lovable-app-broke-in-production)**:
  a checklist for the afternoon it happens.

**For developers**

- **[Sentry alternative for AI-built apps](/use-cases/sentry-alternative)** —
  what Mushi Mushi replaces, what it complements, and a side-by-side table.
- **[Debug apps built with Cursor](/use-cases/debug-cursor-apps)** — the
  report-to-fix loop with Cursor over MCP.
- **[Debug apps built with Claude Code](/use-cases/debug-claude-code-apps)** —
  the same loop for Claude Code queues and draft PRs.
- **[AI code bug fixing](/use-cases/ai-code-bug-fixing)** — the full pipeline
  from user report to merged fix, including lessons that prevent repeats.
- **[MCP server for bug fixing](/use-cases/mcp-bug-fixing-server)** — what a
  bug-fixing MCP server is and the tools Mushi Mushi exposes.

Ready to try it? One command installs the SDK and walks you through your
first report:

```bash
npx mushi-mushi
```

Start with the [incident-loop quickstart](/quickstart/incident-loop). No
terminal? Use the [Lovable or Bolt guide](/quickstart/lovable-bolt) instead.
