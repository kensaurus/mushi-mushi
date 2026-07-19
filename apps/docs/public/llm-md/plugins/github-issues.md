# GitHub Issues

Source: https://kensaur.us/mushi-mushi/docs/plugins/github-issues

---
title: GitHub Issues
---

# GitHub Issues plugin

Opens a labelled GitHub issue when a report is classified, with a backlink to the Mushi report drawer.

## Setup

1. Connect GitHub in **Integrations** (required for repo access).
2. In Mushi: **Marketplace → GitHub Issues → Install**.
3. Set target repo, default labels, and assignee mapping.

## Package

[`@mushi-mushi/plugin-github-issues`](https://www.npmjs.com/package/@mushi-mushi/plugin-github-issues)

## Events

| Event | Action |
| --- | --- |
| `report.classified` | Open issue with Mushi report URL in body |
| `fix.applied` | Close or comment with squash-merge link |
