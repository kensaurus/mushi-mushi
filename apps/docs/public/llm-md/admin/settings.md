# Settings

Source: https://kensaur.us/mushi-mushi/docs/admin/settings

---
title: Settings
---

# Settings

**Route:** `/settings`

> **Scenario:** Your widget copy feels off, you want your own LLM keys on the bill,
> and Slack should ping the channel when a critical bug lands. This page holds every
> project knob — notifications, keys, widget, and developer toggles.

The tab you pick is saved in the URL (`?tab=`).

---

## Tabs

### General

Notifications, Sentry config, the default LLM model, and the deduplication threshold
for report clustering.

### BYOK (API keys)

Configure Anthropic and OpenAI-compatible API keys for the project's LLM pipelines.
Keys are stored encrypted in Supabase Vault.

| Key | Used by |
|-----|---------|
| **Anthropic API key** | `fix-worker`, `classify-report`, `pdca-runner`, `judge-batch` |
| **OpenAI-compatible key** | `fix-worker` (fallback), `test-gen-from-report` |

After saving, only the last four characters are shown.

### Firecrawl

Optional web research provider. When configured, enables the
[Research](/admin/research) page and powers the `drift-walker` crawl:

| Field | Description |
|-------|-------------|
| **Firecrawl API key** | Your BYOK key from firecrawl.dev |
| **Firecrawl base URL** | Optional self-hosted endpoint override |

### Browserbase

Cloud Chromium provider for [QA Coverage](/admin/qa-coverage) when a story’s
provider is `browserbase`. Keys are stored in Vault via
`GET|PUT /v1/admin/byok/browserbase`. Without a project key, the runner falls
back to the platform global key in `mushi_runtime_config`.

| Field | Description |
|-------|-------------|
| **Browserbase API key** | Your BYOK key from browserbase.com |
| **Test connection** | Probes auth / network / quota and shows last test status |

### Health

Live connection status for all configured integrations. Shows the same provider probe
data as the [Integration health](/admin/health) page, scoped to this project. Also
includes the SDK reference (project API keys from **Settings → SDK install** — not a Vite env var) and a
**pipeline smoke test** button.

### Dev tools

Debug logging flag and other local-only developer flags for this project. These settings
are never sent to the SDK or end users.

---

## Changing a key

1. Open the **BYOK** tab.
2. Paste the new key and click **Save**.
3. Navigate to [Integration health](/admin/health) → **Probe now** to verify the new key works.

Do not paste a Supabase `service_role` key here. That key bypasses all row-level
security and must only be used server-side. These BYOK fields are for third-party
AI/integration providers only.

---

## Related pages

- [Integration health](/admin/health) — verify keys with live round-trip tests
- [Storage](/admin/storage) — configure BYO object storage
- [SSO](/admin/sso) — SAML/OIDC identity provider registration
- [Organization members](/admin/teams) — manage access and roles
