# Packet: Supabase Partner Catalog (Technology Partner)

**Status:** ready to submit. The business-viability criterion is a real risk;
see below.
**Owner time:** about 5 minutes.
**Tag:** `supabase.partner`

## Where to submit

- **URL:** https://supabase.com/partners#become-a-partner. For the
  integration variant: https://supabase.com/partners?partner_type=Tech%20Partner#become-a-partner
- **Review:** "Usually a week". The listing is free, and you do not need to be a
  Supabase customer.
- **Sources:** https://supabase.com/partners (cache 2026-11-11) and
  https://supabase.com/docs/guides/integrations/partner-catalog ("Updated Oct 30, 2026"),
  read through Firecrawl on 2026-11-11.

## Form fields

| Field | Value |
|---|---|
| Website | **Leave empty.** It appears before the name fields and looks like a spam trap. |
| First name / Last name | the owner |
| Work email | the address on https://kensaur.us/mushi-mushi/docs/legal/privacy |
| Company name | `Kensaurus 合同会社`. Use the registered English name if the form rejects Japanese. |
| Company website | `https://kensaur.us/mushi-mushi/?src=supabase.partner` |
| How many people work at your company? | `1-5` |
| What type of partnership are you interested in? | `Technology Partner` |
| Any other details you'd like us to know? | the text below |

**Details** (about 700 characters):

```text
Mushi Mushi is open-source bug fixing for apps built with AI. Most of those apps run on Supabase: anything built with Lovable or Bolt, plus many Cursor and Claude Code projects.

The people using an app tap "Report a problem". Mushi Mushi turns each report into a plain-English cause and a fix the builder's AI can apply. It can also check the live site for broken pages.

Mushi Mushi itself runs on Supabase (Postgres, Edge Functions, Auth, Storage, pg_cron). It can be self-hosted on a Supabase project. Our hosted MCP server lets Claude, Cursor and Lovable read the reports.

Code: https://github.com/kensaurus/mushi-mushi (MIT SDKs, AGPLv3 server). We'd like to be listed as a monitoring / bug-fixing integration.
```

## Criteria and where Mushi Mushi stands

| Criterion (quoted from the partner-catalog guide) | State |
|---|---|
| **Business viability:** "official business registration and bank account, meaningful revenue, or Venture Capital backing" | Kensaurus 合同会社 is a registered company. The owner confirms the bank account. Revenue is 0 paid, and there is no VC (owner rule: no fundraising). **Registration and a bank account are enough on the "or" reading.** Do not claim revenue. |
| **Compliance:** "you cannot use 'Supabase' in the name" | pass |
| **Service Level Agreements:** your own Terms and Conditions, Privacy Policy and Acceptable Use Policy | Terms and privacy are at `/docs/legal/terms` and `/docs/legal/privacy` (HTTP 200 on 2026-11-11). Acceptable use is §5 of the terms. Both pages say they are "not a finished legal document". **Owner decision:** submit now, or after the legal review. |
| **Maintainability** | public repo with weekly commits |

## Success metric and kill switch

- **Metric:** accepted (yes or no), then views with the referrer
  `supabase.com` and the tag `supabase.partner`.
- **Kill switch:** if they ask for revenue proof, stop. Re-apply after there
  are paying customers.
