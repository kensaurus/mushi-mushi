# status

Source: https://kensaur.us/mushi-mushi/docs/operating/status

---
description: Mushi Mushi Cloud status. The live status page for the API, hosted MCP, console and docs, what it checks, and what is and is not promised about uptime.
---

# Status & Uptime

  **Status page:** [updown.io/p/b6lod](https://updown.io/p/b6lod) shows live
  availability and history for the Mushi Mushi API, hosted MCP, console, and
  docs.

## What we monitor

The status page runs four HTTPS checks, each every 5 minutes. A check passes
when the endpoint answers and its TLS certificate is valid.

| Check | What it covers |
|-------|---------------|
| **Mushi API (ingest edge function)** | The Supabase edge function that receives reports |
| **Mushi hosted MCP** | The hosted MCP endpoint your editor connects to |
| **Mushi console** | The admin console at `kensaur.us/mushi-mushi/admin` |
| **Mushi docs** | This docs site |

The status page does not measure queue depth, latency percentiles, the
diagnosis pipeline or CLI sign-in. Those show up in the console, not here.

## Uptime commitment

Mushi Mushi Cloud has **no uptime SLA** on the Free, Builder or Studio plans.
It is run on a reasonable-efforts basis. Enterprise terms,
including any SLA, are set in a separate order form (see
[Terms §8](/legal/terms)). Ask at `kensaurus@gmail.com`.

## Incident communication

1. The status page reflects an outage as soon as a check fails.
2. Known incidents may also be posted in
   [GitHub Discussions](https://github.com/kensaurus/mushi-mushi/discussions).

## Reporting availability issues

If you observe degradation not reflected on the status page, email
`kensaurus@gmail.com` with subject `[availability]` or open a thread in
[GitHub Discussions](https://github.com/kensaurus/mushi-mushi/discussions).
For security incidents, use `kensaurus@gmail.com` instead (see
[Security Policy](/security)).
