# Design system

Source: https://kensaur.us/mushi-mushi/docs/admin/design

---
title: Design system
description: The Design system page in Mushi Mushi shows tokens, contrast pairs, type scale and a deviance score for off-token code. Token and rule edits open a draft PR.
---

# Design system

**Route:** `/design`

The Design system page in Mushi Mushi reads the token files `mushi.recipe.json` points at and shows them for the active project. It is the design plane of the [app recipe](/concepts/app-recipe). With no project selected, the page asks you to switch to one.

**App blueprint** in the header opens `/recipe`. **Tokens** and **Directions** switch the view. Directions is `?view=directions`.

With no token files read yet, the page is one step: point Mushi at the files where your colours, spacing and fonts live (**Show me how** opens the recipe-file guide).

## Tokens

A status chip (OK, Needs attention, Not checked yet, Not set up, or Check failed) sits with the reason and where the snapshot came from: repo files, a CI push, derived data, or a connector, plus the short commit when one is recorded. When the scan is OK but the token files have issues, the chip reads Needs attention and the reason counts those issues. A failed refresh or scan is printed under the chip.

Under it, **Your colours** shows the colour tokens as swatches and **Drift from your design** draws the deviance score over time (lower is better; unscored checks are left out).

When the project has more than one token set, a switch lists them and marks the active set from `mushi.recipe.json`. The view then shows:

| Section | What you see |
| --- | --- |
| **Token issues** | Severity, message, and file or token path. Empty: "No token issues in this set." |
| **Drift from your design** | The deviance score, a per-rule breakdown, a trend, the top findings, and **Check for drift**. |
| **Contrast** | An "Aa" sample for each declared pair, the ratio, the minimum it needs, and Pass, Fail, or Not judged. |
| **When the score is too high** | A 0–100 threshold and two switches, off until an owner or admin turns them on. |
| **Token catalogue** | Closed until the edit queue has an edit. Swatches, Latin and Thai type samples, spacing bars, radius boxes, motion values, and other tokens. Filter by name. The first 12 tokens in a section, then **View all**. **Edit** queues a new value. |
| **CSS variables by scope** | One column per `:root`, `@theme`, or declared selector, when the API sends scopes. |
| **Components** | Name and file for each primitive matched from the recipe's component globs. |
| **Drift rules** | Enabled, severity (`info`, `warn`, `error`), allowed values, skipped-file globs, and whether the rule is from `mushi.recipe.json` or a Mushi default. |

If editing is off, the page says so and gives the reason. The two switches under **When the score is too high** are **Fail mushi recipe check --push above the threshold** and **Dispatch a fix for new drift above the threshold**. When dispatch is on and Autofix is off for the project, a warning says nothing will be dispatched until Autofix is on. Its spend and per-day caps apply.

## The deviance score

The score is a whole number from 0 to 100. **0** means the scanned code follows the design tokens. **100** means it does not. The card reads "/ 100 · lower is better." Beside it: Pass, Warn, Fail, Scan error, or Running; when the scan finished; the short commit; files and lines scanned; and findings stored. A partial scan says the file or size cap stopped it early, so the score covers only the files scanned.

**Not scored** means no scan has run, the scan is still running, the scan matched no files, or no enabled rule had anything to judge. The trend chart leaves unscored runs out. Density in the breakdown is findings per 1,000 scanned lines. For contrast, density is the failing share of pairs. Each finding names the rule, file, line, the value, and a suggested token when the scan has one.

**Check for drift** refreshes the tokens, then scans the repo in the background. The page polls until the scan finishes and reloads.

## How an edit becomes a draft PR

Token edits and rule edits share one path: preview the diff, then confirm. Owners and admins of the project's team open the pull request. The preview stays available so you can share it with one of them.

1. On a token, choose **Edit**, set the value (a colour token also has a picker), and **Add to queue**. **Queued token edits** lists each path and its new value. **Remove** and **Clear queue** drop edits. For a rule, change its row and choose **Propose rules change**. Only the fields you changed are sent. Rules live in `mushi.recipe.json`.
2. The preview shows each file, its additions and deletions, the unified diff, and any path left out, with the reason. The page says nothing is written yet.
3. **Open draft PR** sends that same diff. The page then links **Draft PR #N** on its branch. The pull request stays a draft, so CI does not run until you mark it ready. If the server returns no pull request, the page says none was opened. **Discard preview** throws the diff away. **Done** closes the result, and clears a token queue once a pull request is open.

**Directions** draws every art direction side by side from its own tokens: palette, computed contrast, type, a phone mock, assets, and deviance. Only the active direction is scanned. **Set active direction** and **Duplicate / edit direction** (a new folder name, an optional display name, and optional colour edits on the copy) use the same preview and draft PR. With no art directions, the view says none were found.

## Related

- [App recipe](/concepts/app-recipe) — token files, contrast pairs, and deviance rules (`/docs/concepts/app-recipe`)
