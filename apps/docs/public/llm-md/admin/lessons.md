# Lessons

Source: https://kensaur.us/mushi-mushi/docs/admin/lessons

---
title: Lessons
description: The Lessons page turns repeat fixes into rules — when the same root cause keeps returning, Mushi records it so your editor sees it on the next PR.
---

# Lessons

**Route:** `/lessons`

> **Scenario:** Three separate users have reported that the "Save" button on the
> Settings page does nothing on iOS Safari. You've fixed each one individually over
> the past month — but the same root cause (missing `async/await` on the submit
> handler) keeps slipping through PR review. Lessons is the page that stops this
> cycle permanently.

A lesson is a structured coding rule extracted from a cluster of similar bug reports.
Once promoted, it's injected into the LLM's context before every fix-worker run and
every PR review — so the agent and your reviewers are both pre-warned about patterns
that historically caused real user pain.

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
5. **Injection** — the lesson is packed into every fix-worker and PR review context
   (up to 3,000 tokens), ranked by severity × relevance.

When GitHub is connected, promoted lessons are also written to `.mushi/lessons.json`
in your repo. Cursor, Copilot, and other AI assistants that have access to your repo
read this file automatically — no extra setup required.

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
> retrieved when the fix-worker handles a related bug. Or you want to check that a
> retired lesson is no longer surfacing.

Paste any code diff or problem description into the textarea, set a token budget (start
with the default 3000), and click **Query lessons**. The results show exactly what the
fix-worker would receive — with rank, similarity score, and the full rule text.

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
3. Check with **Try a change** that your next fix-worker run will see the rule.

### Cleaning up stale lessons
1. Open the **Rules in use** tab, toggle to **Active**.
2. Sort by frequency — lessons with frequency 0 in the last 30 days may be stale.
3. Click each → review the rule → **Retire** if the underlying code has changed.

---

## How injection works at fix time

When fix-worker starts a run:
1. The incoming report's embedding is used to query the lesson store.
2. Top-N lessons are ranked by `severity × similarity_score`.
3. Lessons are packed into the LLM system prompt up to the 3,000-token budget.
4. The LLM generates a patch with those rules as hard constraints.

**Result:** a lesson promoted from 3 iOS Safari reports means the fix-worker
will never generate a submit handler without `await` again — for any iOS report.

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

- [Knowledge graph](/admin/graph) — visual view of the same clusters as a force-directed graph
- [Judge dashboard](/admin/judge) — the coherence scores that gate promotion
- [Fix drafts](/admin/fixes) — see lessons in action on real fix runs
- [Prompt lab](/admin/prompt-lab) — edit the LLM prompt that generates lesson rule text
