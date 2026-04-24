---
---

Living configuration help — click-to-explain popovers across the admin

Every configuration knob in the admin (80+ across 18 sections) now ships with
a click-to-open `<ConfigHelp>` popover that explains in plain English what the
setting does, the backend table/column it writes to, and which edge function
reads it.

The same content auto-mirrors to `docs/CONFIG_REFERENCE.md`, regenerated from
a single typed dictionary (`apps/admin/src/lib/configDocs.ts`) via
`pnpm gen:config-docs`. A pre-commit guard fails on drift, and a backend
allowlist test fails the build if a documented column ever leaves the API's
`PATCH /v1/admin/settings` whitelist.

Admin-only — no SDK package APIs change. No backend writes change. Existing
short `tooltip="…"` callers keep working untouched (the `helpId` prop is
purely additive on `Field` / `Input` / `SelectField` / `Textarea` / `Checkbox`
/ `Toggle` / `IdField`).

**Popover formatting refresh.** The popover body was restructured for
scannability: a vermillion "CONFIGURATION" eyebrow + larger label heading,
colour-coded left rails per section (brand on the lead `Summary`, neutral on
info, success on the actionable `When to change` tip), the default value
rendered as a typographic chip, and the backend lineage laid out as a
`Writes / Endpoint / Read by` definition list with each `Read by` row as its
own pill. No more uppercase-tracking running prose.

**Inline input validation.** New `apps/admin/src/lib/validators.ts` ships a
small set of pure, unit-tested validators grounded in actual third-party
contracts (Slack/Discord webhook hosts, Sentry DSN shape, Jira project key,
PagerDuty Events API v2 routing key, GitHub repo URL, etc.). `Input` and
`Textarea` accept an opt-in `validate` prop — runs on blur, then re-runs
live after first blur, never yells at the user mid-type. Errors render red
with `aria-invalid`; soft-warn validators (e.g. "your webhook host doesn't
look like Slack — sure?") render amber and don't block save. Wired into the
Slack webhook, Sentry DSN/secret, marketplace plugin install form, and every
field in `PLATFORM_DEFS` / `ROUTING_PROVIDERS` via a declarative
`validator: 'httpsUrl' | 'sentryDsn' | …` name on the field def, resolved by
`resolveValidator()` in the cards. Locked with 40 unit tests.

Operator workflow:

```bash
# 1. Edit apps/admin/src/lib/configDocs.ts
# 2. Regenerate the markdown
pnpm gen:config-docs
# 3. Commit both files together (the pre-commit guard will block you otherwise)
```
