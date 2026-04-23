---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
"@mushi-mushi/react": patch
"@mushi-mushi/vue": patch
"@mushi-mushi/svelte": patch
"@mushi-mushi/angular": patch
"@mushi-mushi/react-native": patch
"@mushi-mushi/capacitor": patch
"@mushi-mushi/node": patch
"@mushi-mushi/adapters": patch
"@mushi-mushi/mcp": patch
"@mushi-mushi/cli": patch
"create-mushi-mushi": patch
"mushi-mushi": patch
---

Growth plan — storefronts pass (2026-04-24)

Phase 0 of the zero-budget 90-day growth plan: polishing the npm pages and
README so they convert attention into stars and installs. No behaviour changes;
metadata only.

- **npm keyword arrays expanded across all 14 publishable packages.** Added
  discoverability terms developers actually type into npm search:
  `user-report`, `feedback-widget`, `sentry-alternative`, `auto-fix`,
  `llm-ops`, `ai-agent`, plus framework-appropriate specifics (e.g.
  `claude-code`, `codex`, `copilot` on `@mushi-mushi/mcp`). Keyword counts
  after the pass: 14–32 per package.
- **README star CTA footer.** Added the bilingual *"もしMushi-chanのお役に立てたら、
  ⭐ をひとつ"* line with links to the stargazers page, issue tracker, and
  Bluesky handle. Research says a single explicit star ask converts 2–5% of
  lurkers.
- **New `docs/marketing/` folder** with the full growth kit: `VOICE.md`,
  `STOREFRONTS.md`, `snippets.md` (drafted hooks, Show HN, Reddit, LinkedIn,
  dev.to, Product Hunt, YouTube Short), `launch-week.md`, `content-plan.md`
  (8 compounding blog post outlines), `drip-channels.md` (11 awesome-lists,
  9 newsletter targets, Discord / Slack etiquette), `social-cadence.md`
  (Bluesky / X weekly rhythm), and `measurement.md` (the 5 numbers to watch
  each Friday).

No SDK surface or runtime changes — safe to land before any launch week.
