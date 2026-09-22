# 0015. Use kensaurus@gmail.com as the product support inbox

Status: Accepted            Date: 2026-09-19

## Context

Store listings, SECURITY.md files, and the public status page need one
reachable human inbox. Auth email templates still link
`support@kensaur.us`, and agents keep minting `support@` aliases that
are not monitored.

## Decision

We use `kensaurus@gmail.com` as the product support inbox for Mushi
(console contact, docs status, security reporting). Do not print
`support@kensaur.us` as the live inbox.

## Rejected alternatives

- **`support@kensaur.us` in templates** (`supabase/email-templates/*`)
  — rejected: not the monitored product inbox. Replace those mailto
  links when the templates are next edited; do not copy the address
  into new copy.
- **A new `support@mushi-*` alias “to look official”** — rejected:
  splits mail across mailboxes nobody checks.

## Consequences

Changing the inbox is a product decision: update listings, SECURITY.md
surfaces, console `CONTACT_EMAIL`, and a superseding ADR in the same
change. Do not “improve” the address in copy only.
