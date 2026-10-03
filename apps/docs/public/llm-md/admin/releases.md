# Releases

Source: https://kensaur.us/mushi-mushi/docs/admin/releases

---
title: Releases
description: The Releases page drafts a changelog for each version from the fixes that shipped, crediting the users whose reports led to each fix.
---

# Releases

**Route:** `/releases`

The Releases page generates AI-drafted changelogs for each version of your app,
attributed to the reporters whose bug reports drove each fix.

---

## What it generates

For each release tag, Mushi:
1. Collects all fix-worker PRs merged between the previous and current tag.
2. Links each PR back to the original reports that triggered it.
3. Asks the LLM to write a user-facing changelog entry — plain English, no jargon.
4. Attributes fixes to the reporters who submitted the original reports (for reward
   accrual and public credit).

---

## Creating a release

1. Click **New release**.
2. Enter the **version tag** (e.g. `v2.4.1`).
3. Set the **date range** for the included fixes.
4. Click **Generate** — the LLM produces a draft in ~10 seconds.
5. Review and edit the draft.
6. Click **Publish**.

The same steps work from a script or an agent with an API key: reads
(`GET /v1/admin/releases`, `/stats`, `/:id`) take `mcp:read`; drafting,
editing, deleting a draft and publishing take `mcp:write`. Publishing messages
every credited reporter, so give a key `mcp:write` only where you would let it
do that. A key bound to one project only sees that project's releases. An
account-level key reaches every project you can reach, with your role in each:
it opens any release in those projects, and `/stats` needs the project named
with `project_id` (or the `X-Mushi-Project-Id` header).

---

## Release automatically when you ship

Off by default. Turn on **Release automatically when you ship** on the
Releases overview (project admins only, or
`PATCH /v1/admin/settings { "auto_release_enabled": true }`). From then on,
any of these ships a release on its own:

| Trigger | Where it comes from | Version reporters see |
|---------|---------------------|-----------------------|
| A GitHub release is **published** (not a draft or pre-release) | The Mushi GitHub App on the repo, subscribed to **Releases** | The tag, e.g. `v2.4.1` |
| A **production** deployment succeeds (`deployment_status` = success) | The Mushi GitHub App, subscribed to **Deployment statuses** | The deployed tag, or the short commit sha |
| Your CI posts `release.published` | `POST /v1/ingest/recipe/events` with an agent key (`mcp:write`) kept in CI secrets | The `version` you send |

```bash
curl -X POST "$MUSHI_API_URL/v1/ingest/recipe/events" \
  -H "X-Mushi-Api-Key: $MUSHI_CI_KEY" -H "Content-Type: application/json" \
  -d '{ "events": [ { "type": "release.published", "targetId": "web", "version": "2.4.1" } ] }'
```

For each trigger, Mushi:

1. skips it if a release with that version already exists;
2. skips it if no report was marked fixed since the last published release
   (a deploy with nothing fixed makes no release);
3. skips it while another automatic draft is open (see below);
4. drafts the release from those reports and publishes it, so each reporter
   gets one "your fix is live" message and credits are stamped once
   delivered.

An automatic release is published without anyone reading it first, and report
summaries come from your users. So its notes are not written by AI. Each fixed
report becomes one line, with markdown escaped and links removed.

Only one automatic draft can be open per project, so a GitHub release and the
deploy it triggers cannot both announce the same fixes. If publishing fails
before the release goes live, the draft stays under **Drafts**, and
auto-release pauses until you publish or delete that draft. The
auto-release card on the Releases overview says so and links to it. If the
release went live but messaging reporters failed part-way, the log says the
release is published and some reporters were not told.

The version must be a plain tag, semver or sha (letters, digits, `.`, `_`,
`+`, `-`, at most 64 characters), because reporters see it.

Send `release.published` with an agent key that has `mcp:write`, minted with
`mushi login` or in the console and kept in CI secrets. A key that cannot
release still has its event recorded, and the answer gives the reason:

| Key | `autoReleaseSkipped` |
|-----|----------------------|
| The public SDK key (`report:write`), even one used only from a native app | `key_lacks_mcp_write` |
| An `mcp:write` key that a web page has ever sent | `browser_exposed_key` |

One request releases at most once, for its last `release.published` event. The
answer gives that version in `autoReleaseVersion` and lists any others in
`autoReleaseIgnoredVersions`.

---

## Release entry fields

| Field | Description |
|-------|-------------|
| **Version** | Tag or semver string |
| **Title** | Optional human-readable title (e.g. "Performance & stability") |
| **Highlights** | Bullet-point summary (AI-generated, editable) |
| **Full changelog** | Detailed list of fixes with links to PRs |
| **Attribution** | Reporter names/aliases who contributed reports |
| **Published at** | When the release was made public |

---

## SDK surface

Once published, releases are queryable via the SDK:
```ts
const releases = await mushi.releases.list({ projectId, limit: 5 })
```

This powers in-app "What's new" surfaces and email digests.

---

## Related pages

- [Fix drafts](/admin/fixes) — the PRs that appear in releases
- [Rewards](/admin/rewards) — attribution drives reward point accrual
- [Intelligence reports](/admin/intelligence) — weekly digest includes top releases
