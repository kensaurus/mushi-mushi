# Jira Cloud

Source: https://kensaur.us/mushi-mushi/docs/plugins/jira

---
title: Jira Cloud
---

# Jira Cloud plugin

Bidirectional sync between Mushi reports and Jira Cloud issues — creates issues on `report.classified`, syncs status, and comments fix summaries on `fix.applied`.

## Setup

1. In Mushi: **Marketplace → Jira Cloud → Install**.
2. Complete OAuth 2.0 (3LO) with your Atlassian app (`read:jira-work`, `write:jira-work`, `offline_access`).
3. Map project key, issue type, and label defaults in the plugin config.

## Package

[`@mushi-mushi/plugin-jira`](https://www.npmjs.com/package/@mushi-mushi/plugin-jira) — see the npm README for OAuth helpers and webhook receiver examples.

## Events

| Event | Action |
| --- | --- |
| `report.classified` | Create or update Jira issue with Mushi metadata |
| `report.status_changed` | Transition Jira issue status |
| `fix.applied` | Comment with fix PR link |
