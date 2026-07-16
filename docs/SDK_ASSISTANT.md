# Mushi Page-Aware Assistant

A knowledge-grounded **"Ask" tab** inside the Mushi SDK widget. End users ask
questions about the app they're looking at and get answers grounded in the
current page context and an operator-authored knowledge corpus — using your own
LLM key, with every turn logged.

This is the in-SDK sibling of the admin console's "Ask Mushi" chatbot
(`api/routes/ask-mushi.ts`), redesigned for **untrusted end users** rather than
trusted operators.

## Table of contents

- [Security model](#security-model)
- [Architecture](#architecture)
- [Database schema](#database-schema)
- [Enabling the assistant](#enabling-the-assistant)
- [SDK integration](#sdk-integration)
- [API reference](#api-reference)
- [BYOK, cost & logging](#byok-cost--logging)
- [Limits & failure modes](#limits--failure-modes)

---

## Security model

The assistant is designed so it **cannot** leak another user's data, your source
code, or your environment. There is no per-user RAG and no cross-tenant read in
v1.

| Guarantee | How it's enforced |
|---|---|
| No cross-user data leak | The LLM is grounded **only** in the page context the SDK publishes and the operator's `assistant_knowledge` corpus. It never queries user rows, other tenants, or app data. |
| No secret / source / env disclosure | The system prompt hard-forbids revealing secrets, env vars, source, internal IDs, stack traces, or API keys. |
| Prompt-injection resistance | The user's message is treated as untrusted **data**, not instructions; attempts to override the rules or extract the prompt are declined. |
| Knowledge corpus is clean | `PUT …/assistant` **secret-scans** the corpus before persisting (rejects private keys, `sk-…`, `sk-ant-…`, AWS keys, GitHub tokens, JWTs, DB connection strings, Slack tokens) and caps it at 40,000 chars. |
| Auditable | Every user + assistant turn is written to `sdk_assistant_messages` (route, model, tokens, cost, latency). |
| Tenant isolation | `apiKeyAuth` scopes every call to one project; the corpus and LLM key never leave the server. |

The optional `X-Mushi-User-Token` (a signed end-user identity JWT) is verified
**for audit/abuse triage only** — no user-specific data is fetched, so a forged
or absent token cannot widen the blast radius.

### Login-free by design

Ask does **not** soft-gate on login. Identity JWT never unlocks more answers in
v1. Session resume for the Ask tab uses **`sessionStorage` only** (same-tab
reload keeps the transcript + `threadId` for UX). Clearing the tab/session
drops it. That is intentional — do not wire Ask history to end-user accounts
without a separate product decision.

Recovery when Ask cannot help: clarify turns and unsure answers surface a
primary **File a report** CTA that opens the normal report flow (no auth).

---

## Architecture

```
┌──────────────────────────── Host app (browser / RN / Capacitor) ────────────┐
│  Mushi widget "Ask" tab                                                       │
│    mushi.publishPageContext({ route, title, summary, filters, selection })    │
│    mushi.openAssistant()                                                      │
│    apiClient.askAssistant({ message, threadId, context })                     │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                     │  POST /v1/sdk/assistant
                                     │  X-Mushi-Api-Key · X-Mushi-Project
                                     │  X-Mushi-User-Token (optional, audit only)
                                     ▼
┌──────────────────── Mushi Hono edge function (api) ──────────────────────────┐
│  apiKeyAuth → scope to project                                                │
│  per-project rate limit (scoped_rate_limit_claim, 240/hr)                     │
│  load project_settings.assistant_enabled + assistant_knowledge                │
│  build security-hardened system prompt (page context + knowledge)             │
│  withAnthropicOrOpenAi(db, projectId, …)   ← BYOK key resolution              │
│    generateObject({ schema: ReplyLlmSchema })  ← structured answer/clarify    │
│  log user + assistant turns → sdk_assistant_messages                          │
│  logLlmInvocation (cost / tokens / latency / keySource)                       │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                     ▼
                  { ok: true, data: { kind, text|question, steps?, options?, threadId } }
```

---

## Database schema

### `project_settings` (assistant columns)

Added by `supabase/migrations/20260618001234_sdk_assistant.sql`.

| Column | Type | Description |
|---|---|---|
| `assistant_enabled` | bool (default `false`) | Master switch for the "Ask" tab |
| `assistant_label` | text | Tab label (default `"Ask"`) |
| `assistant_greeting` | text | Greeting shown on an empty thread |
| `assistant_suggestions` | jsonb | Starter-question chips (array of strings, ≤ 6) |
| `assistant_knowledge` | text | Operator-authored corpus the LLM may cite (≤ 40k chars, secret-scanned on write) |

### `sdk_assistant_messages`

Per-turn audit log. **Service-role only** — the SDK never reads/writes it
directly; all access flows through the edge function. An explicit `RESTRICTIVE`
deny-all policy locks out `anon` / `authenticated` and silences the "RLS
enabled, no policy" advisor.

| Column | Type | Description |
|---|---|---|
| `id` | uuid PK | |
| `project_id` | uuid FK → projects | |
| `thread_id` | uuid | Groups turns in one conversation |
| `end_user_id` | uuid? FK → end_users | Set when a verified identity token was sent |
| `reporter_token_hash` | text? | Anonymous reporter token hash |
| `role` | text | `user` or `assistant` |
| `content` | text | The message text |
| `route` | text? | Page route the question was asked from |
| `model` | text? | Model used (assistant turns) |
| `fallback_used` | bool? | True when the OpenAI fallback served the turn |
| `input_tokens` / `output_tokens` | int? | Usage |
| `cost_usd` | numeric(12,6)? | Estimated cost |
| `latency_ms` | int? | Round-trip latency |
| `created_at` | timestamptz | |

---

## Enabling the assistant

### In the admin console

1. Open **Projects → (your project) → "Preview, configure & install the SDK widget"**.
2. In the **Page-aware assistant** card, flip the toggle on.
3. (Optional) set a greeting, tab label, and starter questions.
4. Open **Advanced — knowledge & logs** and paste your app knowledge: features,
   pricing, common how-tos, FAQs. **Never paste secrets** — the save button
   rejects anything that looks like a key/token.
5. Click **Save assistant**.

The widget picks up the change from `GET /v1/sdk/config` (cached 60 s) — no
host-app rebuild required.

### LLM key (BYOK)

The assistant uses the project's own LLM key resolved via
`withAnthropicOrOpenAi` → `resolveLlmKey` (`byok_keys` → legacy
`project_settings` columns → platform env). Set keys in **Settings → API Keys**.
Anthropic is primary; OpenAI is the structured-output fallback.

---

## SDK integration

The client wiring ships in the SDK packages; you only publish page context.

```typescript
import { useMushi } from '@mushi-mushi/react' // or the web/RN/Capacitor SDK

function ActivityScreen() {
  const mushi = useMushi()

  // Tell the assistant what the user is looking at. Call on navigation / filter
  // change. NEVER include another user's data, secrets, or raw tokens here.
  useEffect(() => {
    mushi.publishPageContext({
      route: '/activity',
      title: 'Activity',
      summary: 'A list of the team\'s recent transactions.',
      filters: { month: '2026-06', status: 'cleared' },
      selection: null,
    })
  }, [/* deps */])

  // Open the widget directly on the assistant tab from your own "Help" button:
  return <button onClick={() => mushi.openAssistant()}>Ask</button>
}
```

The widget's "Ask" tab calls `apiClient.askAssistant()` internally — you do not
call the API directly.

---

## API reference

### `POST /v1/sdk/assistant`

Auth: `apiKeyAuth` (`X-Mushi-Api-Key` + `X-Mushi-Project`). Optional
`X-Mushi-User-Token` (signed identity JWT, audit only).

**Request:**

```json
{
  "message": "How do I export my transactions?",
  "threadId": "5f3c…",                 // optional; server mints one if omitted
  "context": {
    "route": "/activity",
    "title": "Activity",
    "summary": "A list of the team's recent transactions.",
    "filters": { "month": "2026-06" },
    "selection": null
  }
}
```

**Response — answer:**

```json
{
  "ok": true,
  "data": {
    "kind": "answer",
    "text": "Open the ⋯ menu in the top-right and choose Export → CSV.",
    "steps": [{ "label": "Open the ⋯ menu", "detail": "Top-right of the Activity page" }],
    "threadId": "5f3c…"
  }
}
```

**Response — clarify** (when the request is ambiguous):

```json
{
  "ok": true,
  "data": {
    "kind": "clarify",
    "question": "Which export did you mean?",
    "options": ["CSV", "PDF statement", "Tax summary"],
    "threadId": "5f3c…"
  }
}
```

**Error codes:** `INVALID_JSON` (400), `EMPTY_MESSAGE` (400),
`ASSISTANT_DISABLED` (403), `RATE_LIMITED` (429), `ASSISTANT_ERROR` (502).

### `GET /v1/admin/projects/:id/assistant`

Auth: `jwtAuth` (project owner / org admin). Returns the current config plus
`knowledgeChars` / `knowledgeCap`.

### `PUT /v1/admin/projects/:id/assistant`

Auth: `jwtAuth`. Body accepts any of `enabled`, `label`, `greeting`,
`suggestions[]`, `knowledge`. The knowledge text is **secret-scanned** —
returns `422 SECRET_DETECTED` if it matches a key/token/connection-string
pattern — and capped at 40k chars.

### `GET /v1/admin/projects/:id/assistant/logs?limit=50`

Auth: `jwtAuth`. Recent turns (newest first, max 200) for audit + cost review.

### `GET /v1/sdk/config`

The existing SDK config endpoint now includes an `assistant` block:

```json
{
  "assistant": {
    "enabled": true,
    "label": "Ask",
    "greeting": "Hi! Ask me anything about this page.",
    "suggestions": ["How do I export?", "Where are my settings?"]
  }
}
```

The corpus and LLM keys are **never** included here — only display config.

---

## BYOK, cost & logging

- **Key resolution:** `byok_keys` → legacy `project_settings.byok_*` → platform
  env, via `resolveLlmKey`. Anthropic primary (`ASSIST_MODEL`), OpenAI fallback
  (`ASSIST_FALLBACK`).
- **Metering:** `logLlmInvocation` records model, tokens, cost, latency, and
  key source for every turn (same telemetry surface as triage / Ask Mushi).
- **Audit:** both the user message and the assistant reply are written to
  `sdk_assistant_messages` with the page route and usage, queryable via the logs
  endpoint.

---

## Limits & failure modes

| Limit | Value | Where |
|---|---|---|
| Message length | 2,000 chars (truncated) | route |
| Knowledge corpus | 40,000 chars | route + PUT |
| Starter chips | 6 | config |
| Rate limit | 240 turns / hour / project | `scoped_rate_limit_claim` |
| Max output | 500 tokens | route |

- **Disabled:** if `assistant_enabled` is false, the route returns `403
  ASSISTANT_DISABLED` and the widget hides the tab.
- **No knowledge + thin page context:** the assistant says it's not sure and
  suggests filing a report rather than inventing an answer.
- **LLM error / no key:** returns `502 ASSISTANT_ERROR`; the failure is logged
  with `status: 'error'`. Rate-limit RPC failures **fail open** (a transient
  infra hiccup never blocks a paying customer; the BYOK key + token budget still
  bound spend).
