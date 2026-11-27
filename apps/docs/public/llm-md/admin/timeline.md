# Timeline

Source: https://kensaur.us/mushi-mushi/docs/admin/timeline

---
title: Timeline
description: The Timeline page in Mushi Mushi shows how your app changed release by release, with the bugs each release fixed, the screens your agent improved, scores, AI cost and a before/after of every screen.
robots:
  index: false
  follow: true
---

# Timeline

**Route:** `/timeline` (sidebar: More pages → Fix → Timeline. It is a Lab: switch it on under **Settings → Display & sidebar → Labs** to keep it in the sidebar)

> **Scenario:** You have shipped a few releases and want to see, and show, how the
> app actually got better: what each release fixed, which screens changed, and what
> the AI checks cost along the way.

The rail across the top has one stop per release, oldest on the left. Work after
your newest release sits on **Unreleased**. No releases yet? Then each UX run or
scorecard run is a stop. Pick a stop by clicking it, dragging the slider under the
rail, or the arrow keys. Each stop lists:

- the bugs it fixed (the release's own list, else the bugs fixed since the release before);
- the screens the UX loop improved;
- the scorecard's average for its newest scorecard run;
- what its runs spent on AI calls.

## Pin each release's screens

**Pin current screens** copies the newest screenshot of every screen from your last
runs and keeps it for that release. A UX run's kept version counts only once its pull
request merged, because until then your users still see the original. Pinning makes no
AI call. Then pick a screen to see its filmstrip, one shot per release, and drag the
handle on the comparison to see the before and the after.

```bash
mushi-ux scorecard --url https://your-app.example --profile-dir <signed-in profile> --sync
# then press Pin current screens on the release, or let your agent call the API:
curl -X POST "$MUSHI_API/v1/admin/projects/$PROJECT/timeline/baselines" \
  -H "X-Mushi-Api-Key: $MUSHI_API_KEY" -d '{"version":"1.4.0"}'
```

Pinned shots of the last 24 releases of each screen are kept (change it next to
**Screens**). Mark a shot **Keep forever** to keep it beyond that. Switch on
**Pin on publish** to pin the screens automatically each time you publish a
release (off by default). Viewers see these controls but cannot change them.

  The scorecard scores a page with an AI call only when the page changed: the same
  text and the same look as a run in the last 30 days reuses that score, with
  today's speed and accessibility measurements applied. The cost card shows how much
  was reused.

## From your editor

Your agent can read the same data through MCP: `get_timeline` (the rail, the screens
and the last 30 days) and `get_surface_history` (one screen's shots, scores and kept
changes). `get_ux_run` reads one run. `start_ux_run` gives the console link and the
command to start a run; it never starts a cloud run by itself.
