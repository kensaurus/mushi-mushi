# Setup Copilot

Source: https://kensaur.us/mushi-mushi/docs/admin/setup-copilot

---
title: Setup Copilot
description: Setup Copilot, now Set up > Fix a problem in Mushi Mushi, checks a project's SDK heartbeat, version and fix dispatch, with copy-paste CLI commands per step.
---

# Setup Copilot

**Route:** `/setup-copilot` redirects to `/onboarding?tab=diagnose`, the **Fix a problem**
tab of the **Set up** page. It is no longer a page of its own.

> **Scenario:** SDK and CLI are almost wired, but you want a guided checklist
> that verifies ingest + dispatch with copy-paste commands.

The **Fix a problem** tab in Mushi Mushi checks the active project in four sections:

1. **Connect credentials**: a copy-paste `mushi connect --api-key … --project-id …
   --endpoint … --wait` command, or `mushi init` / `mushi upgrade` in your app repo.
   Wait for the SDK heartbeat.
2. **Install snippet**, plus **CI & store builds**: the environment variables your CI
   and store builds need (for Expo, `EXPO_PUBLIC_*` values are compiled in, so rebuild
   after a change).
3. **SDK health**: the heartbeat compared with the console's API host, which catches an
   SDK pointed at the wrong endpoint, the installed SDK version, and **Create Upgrade PR**
   when it is behind.
4. **Verify both tracks**: separate checks for reports coming in and fixes going out.

Use it after [CLI device auth](/admin/cli-auth) and the Connect install, or when
`mushi doctor` reports gaps.

## Related pages

- [Connect hub](/admin/connect): install SDK / MCP / CLI
- [CLI device auth](/admin/cli-auth): approve `mushi login`
- [Onboarding](/admin/onboarding): the rest of the Set up page
