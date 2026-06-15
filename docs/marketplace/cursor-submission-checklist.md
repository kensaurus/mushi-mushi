# Cursor Marketplace Submission Checklist

Use this checklist before submitting the Mushi Mushi plugin to the Cursor Marketplace.

## Pre-submission

### Package
- [ ] `@mushi-mushi/mcp` published to npm with latest version
- [ ] `packages/mcp/README.md` up to date with current tool list and install instructions
- [ ] `packages/mcp/CHANGELOG.md` includes the current release entry
- [ ] All CI checks pass on main: typecheck, test, build, catalog sync, smoke, plugin manifest

### Plugin bundle (`packages/cursor-plugin/`)
- [ ] `.cursor-plugin/plugin.json` — version matches `@mushi-mushi/mcp` npm version
- [ ] `mcp.json` — hosted URL reflects live Supabase edge function URL
- [ ] `skills/mushi-triage/SKILL.md` — workflow steps are accurate and up to date
- [ ] `rules/mushi-mcp.mdc` — write-tool list matches current catalog `mcp:write` tools
- [ ] All three command files exist and reference current tool names
- [ ] `README.md` — install instructions, tool table, security notes accurate
- [ ] `node scripts/check-cursor-plugin.mjs` — passes with 0 failures

### Marketplace docs
- [ ] `docs/marketplace/cursor-mushi-plugin.md` — security notes, tool table, install options
- [ ] Screenshots of agent triage flow saved to `.playwright-mcp/`
- [ ] `node scripts/check-mcp-publish-readiness.mjs` — passes with 0 failures

## Submission

1. Ensure the plugin bundle is in a publicly accessible Git repository.
2. Go to [cursor.sh/marketplace](https://cursor.sh/marketplace) (or the current submission URL from Cursor docs).
3. Submit the Git repo URL pointing to the `packages/cursor-plugin/` subdirectory, or the root if the plugin is in a dedicated repo.
4. Fill in the marketplace listing form:
   - **Name**: Mushi Mushi
   - **Description**: User-felt bug triage, evidence, and fix dispatch — powered by real user reports.
   - **Categories**: Monitoring, Debugging, Productivity
   - **Icon**: `https://raw.githubusercontent.com/kensaurus/mushi-mushi/main/packages/brand/src/logo-mark-512.png`
   - **Homepage**: `https://kensaur.us/mushi-mushi`
   - **Privacy policy**: `https://kensaur.us/mushi-mushi/privacy`
5. Wait for Cursor review (typically days to weeks).

## Post-submission

- [ ] Add `cursor.directory` listing via PR to [cursor.directory](https://cursor.directory)
- [ ] Update `packages/mcp/README.md` with marketplace install badge once published
- [ ] Announce in Mushi changelog and docs

## cursor.directory listing

Submit a PR to [cursor.directory](https://cursor.directory) with:

```yaml
name: Mushi Mushi
description: User-felt bug triage, evidence, and fix dispatch inside Cursor. Connect to your Mushi project to investigate reports, read console logs, check blast radius, and dispatch fix PRs.
url: https://github.com/mushi-mushi/mushi-mushi/tree/master/packages/cursor-plugin
categories:
  - monitoring
  - debugging
  - productivity
install: npx @mushi-mushi/mcp
```
