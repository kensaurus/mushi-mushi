# Spam & abuse

Source: https://kensaur.us/mushi-mushi/docs/admin/anti-gaming

---
title: Spam & abuse
description: The Spam & abuse page in Mushi Mushi lists devices that send reports and flags any that look like one person with many accounts or a report flood, for review.
---

# Spam & abuse

**Route:** `/anti-gaming` (sidebar: **Spam & abuse**, under Bugs; the page was called Anti-gaming before October 2026)

Mushi Mushi tracks every device that sends reports to your project and flags the ones
whose pattern looks like abuse: many reporter accounts behind one device, or one reporter
sending a flood of reports. Review the flagged devices here and clear the ones that are fine.

---

## How detection works

Every incoming report runs three server-side checks. The thresholds are fixed in the
server code; there is no per-project setting for them.

| Check | Flags a device when |
|------|----------------|
| **Cross-account** | 5 or more reporter identities share one SDK fingerprint hash |
| **Multi-account** | More than 3 reporter tokens come from one device fingerprint (IP and User-Agent). When the User-Agent is a script (`node`, `curl`, …) the reason says so, because one server relaying many users' reports looks the same. |
| **Velocity** | One reporter sends more than 10 reports in 24 hours |

A flag never blocks a report. The report is still stored, triaged and fixed normally;
the flag only marks the device for review.

---

## The page

- **Tiles:** Tracked devices, Flagged, Cross-account, Total reports.
- **Device list:** switch between flagged and all tracked devices, group by **Flat**,
  **Date** or **Status** (Cross-account, Flagged, Tracked), and search by fingerprint,
  token, IP or reason. Open a row for its details.
- **Recent events:** the log of flags and unflags, filterable by type.
  `/anti-gaming?tab=events` opens it directly.
- **Withheld tester redemptions** (super-admin only, shown when there are any): gift-card
  redemptions paused by the tester anti-fraud checks, each with **Approve** or **Deny**
  (deny refunds the points).

---

## Actions

| Action | Description |
|--------|-------------|
| **Flag as suspicious** | Flag the device by hand, with a short reason |
| **Unflag device** | Clear the flag. Tokens already seen count as reviewed, so the device is not re-flagged by its very next report. |

Flagging a device does NOT delete its reports. When a flagged device belongs to a reporter,
the reporter is marked with an anti-fraud flag: they drop off the rewards leaderboard and
their reward payouts are withheld for review.

---

## API

```bash
GET  /v1/admin/anti-gaming/stats?project_id=<pid>
GET  /v1/admin/anti-gaming/devices
GET  /v1/admin/anti-gaming/events
POST /v1/admin/anti-gaming/devices/:id/flag     { "reason": "..." }
POST /v1/admin/anti-gaming/devices/:id/unflag
```

---

## Related pages

- [Reports](/admin/reports): the reports these devices sent
- [Rewards](/admin/rewards): the reward program that abuse targets
