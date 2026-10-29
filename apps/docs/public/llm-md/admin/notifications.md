# Reporter updates

Source: https://kensaur.us/mushi-mushi/docs/admin/notifications

---
title: Reporter updates
description: The Reporter updates page in Mushi Mushi lists widget messages your reporters see, so you can check they hear back when a bug is diagnosed, fixed and shipped.
---

# Reporter updates

**Route:** `/notifications` (sidebar: **Reporter updates**; formerly Notifications)

When someone reports a bug through your app, Mushi Mushi queues messages for them: when
the report is diagnosed, when it is fixed or the fix failed, when they earn a reward, and
when someone replies to their comment. The SDK widget polls for these messages. This page
lists them so you can check that the loop back to reporters works.

It shows messages to reporters only. Alerts to your team go to Slack, Discord and the
other channels set up in [Integrations](/admin/integrations).

The tabs are **Summary**, **Sent**, **How they hear back** and **Setup**.

---

## Message types

| Type | When it is queued |
|------------|--------------|
| `classified` | The report was diagnosed |
| `fixed` | The report was marked fixed |
| `fix_failed` | A fix attempt for the report failed |
| `reward` | The reporter earned points or a tier |
| `comment_reply` | Someone replied to the reporter's comment |

---

## Sent tab

Each row shows the type, the message, whether the reporter has read it (and when), a
short form of the reporter's key, and a link to the report. Expand a row for the full
JSON payload. Filter by type, or show unread messages only.

**Mark read** on a row, or **Mark all read**, marks messages read once you have checked
them.

---

## If reporters hear nothing

1. Open **Setup**: reporter updates must be on, and **Reporter loop prerequisites** lists
   what else is missing.
2. If reports exist but no messages appear, the updates are off or nothing has been
   diagnosed or fixed yet.
3. If messages stay unread for a long time, check that the widget in your app is running
   a current SDK and can reach Mushi Mushi.

---

## Related pages

- [Tester rewards](/admin/rewards) — where `reward` messages come from
- [Releases](/admin/releases) — publishing a release tells credited reporters their fix shipped
- [Settings](/admin/settings) — project settings
