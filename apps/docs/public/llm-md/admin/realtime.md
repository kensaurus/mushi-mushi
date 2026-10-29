# Real-time collaboration

Source: https://kensaur.us/mushi-mushi/docs/admin/realtime

---
title: Real-time collaboration
description: How Mushi Mushi report pages update live, showing who else has the report open and new triage notes as teammates or the reporter post them.
---

# Real-time collaboration

There is no separate page for this. In Mushi Mushi, every report detail page
(`/reports/:id`) shows who else has it open, and its triage thread updates live, so you
can review a bug with a teammate without refreshing.

---

## Presence

The report header shows an avatar stack of the other teammates who have the same report
open. Hover an avatar to see the name and what they are doing (`viewing`, `editing` or
`commenting`).

| State | Indicator |
| ----- | --------- |
| Only you | Nothing shown |
| 1–5 others | One avatar each |
| More than 5 others | Five avatars and **+N** |

Presence is stored in the `report_presence` table. Each open page sends a heartbeat every
20 seconds, and a row expires 60 seconds after its last heartbeat, so a closed tab drops
off within a minute.

---

## Triage thread

The **Triage thread** section of the report holds notes from your team and replies from
the reporter, stored in the `report_comments` table. The console subscribes to the
thread through **Supabase Realtime**, so a new note appears without a refresh.

### Writing a note

Type in **Add a triage note…** and click **Post**. Notes are plain text (line breaks are
kept; Markdown is not rendered), up to 10,000 characters.

Check **Reply to reporter** (or click **Message reporter**) to send the note to the
person who filed the bug. It shows a **visible to reporter** badge and reaches them in the
SDK widget's inbox. Without it, the note stays internal.

Replies from the reporter appear in the same thread with a **reporter replied** badge. A
reply that says the fix did not work also shows a feedback tag, and a regression reopen is
filed automatically.

### Deleting a note

You can delete only notes you wrote (the × on your own note, then confirm). Notes
cannot be edited.

### Timestamps

Each note shows a relative time ("3 minutes ago").

  There is no @mention, no file attachment, no edit window and no Watch toggle on report
  notes. Earlier versions of this page described them, but the console does not have them.

---

## See also

- [Admin → Reports](/admin/reports): the report detail page where this happens.
- [Admin → Teams and Members](/admin/teams): manage who has access to your project.
