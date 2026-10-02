# Open metrics

Source: https://kensaur.us/mushi-mushi/docs/open

---
title: Open metrics
description: Mushi Mushi's public numbers (releases, commits, contributors, npm downloads), fetched from public APIs at build time, with what each one does not mean.
---

# Open metrics

Mushi Mushi is built in public. This page shows the numbers anyone can check
for themselves, fetched from the GitHub and npm APIs each time the site is
built. A number that could not be fetched says so instead of showing zero.

## What is not on this page, and why

- **The GitHub star count.** It is small and says little about whether anyone
  uses Mushi. The repository is
  [public](https://github.com/kensaurus/mushi-mushi) if you want to look.
- **Product usage, unless it is published above.** Signups, activated
  projects and paying customers come from our own database, not a public API.
  The last published snapshot is in the build-in-public post
  [I shipped a bug tool for 5 months and got 9 signups](/blog/nine-signups-what-the-data-said)
  (numbers as of 2026-09-20).

## Where the numbers come from

| Number | Source |
|---|---|
| Package releases (one per published package version) and weekly digests | [GitHub releases](https://github.com/kensaurus/mushi-mushi/releases) |
| Commits, last 30 days | GitHub commits on the default branch |
| Contributors | [GitHub contributors](https://github.com/kensaurus/mushi-mushi/graphs/contributors) |
| npm downloads | The [npm downloads API](https://github.com/npm/registry/blob/main/docs/download-counts.md), last 7 days per package |

Everything that ships is also in the [changelog](/changelog).
