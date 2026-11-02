# Lessons

Source: https://kensaur.us/mushi-mushi/docs/admin/lessons

---
title: Lessons
description: The Lessons page in the Mushi Mushi console turns a bug that keeps coming back into a coding rule your editor agent can read before its next fix.
---

# Lessons

**Route:** `/lessons`

> **Scenario:** Three separate users have reported that the "Save" button on the
> Settings page does nothing on iOS Safari. You've fixed each one individually over
> the past month — but the same root cause (missing `async/await` on the submit
> handler) keeps slipping through PR review. Lessons is the page that stops this
> cycle permanently.

In Mushi Mushi, a lesson is a structured coding rule extracted from a cluster of similar
bug reports. Once promoted, your editor agent can read it before it writes a fix: through
the MCP tools `query_lessons` and `list_lessons`, or from `.mushi/lessons.json` in your repo.

---

## The lifecycle: how a report becomes a rule

1. **Reports arrive** — users submit feedback via the SDK.
2. **Embeddings cluster** — reports with similar semantics are grouped into a
   **mistake cluster** automatically.
3. **Ready to promote** — once at least 3 reports share one cause and Mushi has
   suggested a rule, the pattern is ready. (Behind the scenes a pattern whose reports
   read very alike, coherence 0.75 or more, is promoted for you every 6 hours.)
4. **You promote** — open **Recurring patterns**, read the suggested rule, and click
   **Promote**. The pattern becomes a rule in use.
5. **Retrieval** — when an agent asks for lessons on a change, the best matches are
   packed into a token budget (3,000 by default), ranked by similarity, severity and
   how recent the lesson is.

Mushi Mushi does not commit `.mushi/lessons.json` to your repo by itself. Write or
refresh it with `npx @mushi-mushi/cli sync-lessons` (locally or in CI). Editor agents
read it when their rules tell them to; `mushi setup --with-rules` adds that rule.

---

## Tab: Recurring patterns (`?tab=clusters`)

The page opens here when a pattern is ready. Bugs that keep coming back with the same
cause, most reports first. Each card shows the report count, the suggested rule and
when it was last seen. **Promote** appears only where it can succeed (3 or more
reports and a suggested rule); the first one is the primary button.

**Filter to `Not a rule yet`** to see only patterns that are not rules.

For each pattern, check:
1. **Report count** — 3 or more reports describing the same cause.
2. **Suggested rule** — does it make sense as a coding instruction?
3. **Last seen** — is this still happening? If it's months old and you've shipped a fix, leave it.

A pattern of 2 reports isn't reliable enough to write a codebase rule: it reads
**Still growing** until more reports arrive.

---

## Tab: Rules in use (`?tab=lessons`)

Your active coding rules. Each row shows the severity, how many times it was seen,
the pattern it came from, and the first two lines of the rule text.

**Click any row** to open the detail drawer with the full content:

- **Rule** — the positive instruction (e.g. *"Always await the form submit handler
  before accessing `event.target` values in Safari"*)
- **What to avoid** — the specific code pattern to avoid
- **Summary** — what the original reports described
- **Learned from** — the pattern's name and report count

### When to retire a lesson

Use **Retire** when:
- The affected code has been fully refactored and the pattern no longer applies.
- The rule is generating false positives — the agent is avoiding good patterns.
- A newer, more specific lesson supersedes it.

Retired lessons are hidden from injection but preserved. Use the **Active / Retired**
toggle to review them and restore if needed.

---

## Tab: Try a change (`?tab=query`)

> **Use this when:** You've just promoted a new lesson and want to confirm it will be
> retrieved for a related change. Or you want to check that a retired lesson is no
> longer surfacing.

Paste any code diff or problem description into the textarea, set a token budget (start
with the default 3000), and click **Query lessons**. The results show what `query_lessons` would return to an
agent: rank, similarity score and the full rule text.

**Practical example:**
- Paste the diff of a recent iOS bug fix.
- Check whether the Settings submit-handler lesson appears in the top results.
- If it doesn't, the embedding may not be close enough — consider editing the lesson's
  rule text to include more specific terminology.

---

## Common tasks

### Reviewing new patterns (weekly)
1. Open **Recurring patterns**, filter to `Not a rule yet`.
2. For each pattern marked **Ready to promote**: read the suggested rule. Sensible? Click **Promote**.
3. Patterns marked **Still growing** have only 1–2 reports: leave them to collect more.

### After fixing a recurring bug
1. Open **Recurring patterns** and find the pattern for this bug.
2. If it is ready to promote, promote it.
3. Check with **Try a change** that the rule comes back for a related change.

### Cleaning up stale lessons
1. Open the **Rules in use** tab, toggle to **Active**.
2. Sort by frequency — lessons with frequency 0 in the last 30 days may be stale.
3. Click each → review the rule → **Retire** if the underlying code has changed.

---

## How retrieval works

When an agent calls `query_lessons` (or you use **Try a change**):
1. The pasted change or description is matched against the lesson store by meaning.
2. Matches are scored `0.5 × similarity + 0.3 × severity + 0.2 × recency`.
3. Lessons are packed, best first, until the token budget (default 3,000, allowed
   100 to 8,000) is full.

A lesson raises the odds that the agent avoids the pattern. It is not a guarantee: the
agent still has to read and follow it.

---

## API

```bash
GET   /v1/admin/lessons?limit=100
PATCH /v1/admin/lessons/:id          { "retired": true }
GET   /v1/admin/clusters?limit=100&status=candidate
POST  /v1/admin/clusters/:id/promote
POST  /v1/admin/lessons/query        { "diff": "...", "token_budget": 3000 }
```

---

## Related pages

- [Bug clusters](/admin/graph) — bugs grouped by shared cause
- [Fixes](/admin/fixes) — the fix runs a lesson is meant to inform
- [Schema changes](/admin/drift) — a serious finding can become a candidate lesson
