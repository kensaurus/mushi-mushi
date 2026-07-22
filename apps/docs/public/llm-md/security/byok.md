# Bring-your-own-key

Source: https://kensaur.us/mushi-mushi/docs/security/byok

---
title: Bring-your-own-key
---

# Bring-your-own-key (BYOK)

> **Scenario:** Your company policy requires that all LLM calls use an API key that belongs to your own Anthropic / OpenAI account so usage appears in your own billing dashboard and never routes through a third party.

Mushi supports project-scoped BYOK. When set, every classifier, judge, fix orchestrator, and intelligence-report run for that project uses your key — usage shows up in your provider console, not Mushi's.

## Setup

In the admin console: **Settings → BYOK**.

1. Paste your `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` into the form.
2. Click **Save**. The values are written into **Supabase Vault** and only resolved at LLM-invocation time via `vault.resolve_secret()`. The DB row stores only the secret ID — the key is never returned to the frontend.

  Keys take effect on the **next** LLM call. No Edge Function redeploy is required. If you rotate a key, update it here — stale keys return `401` from Anthropic/OpenAI and the health probe on **Settings → Health** will turn red.

## What uses the key

| Function | Models |
| --- | --- |
| `classify-report` | Claude 3.5 Haiku (fast classifier) |
| `fix-worker` | Claude 3.7 Sonnet (fix generation) |
| `judge-batch` | GPT-4o (cross-model judge) or Claude Opus |
| `intelligence-report` | Claude 3.7 Sonnet (narrative summary) |
| `pdca-runner` | Configured per project (`producer_model`, `judge_model`, `critic_model`) |

If only one provider key is set, functions that default to the missing provider fall back to the Mushi platform key. Set both to ensure full isolation.

## Audit trail

Every set / rotate / clear operation writes a row to `byok_audit_log`:

```sql
select actor_id, action, provider, occurred_at
from public.byok_audit_log
where project_id = 'YOUR_PROJECT_ID'
order by occurred_at desc;
```

`action` is one of `set`, `rotated`, `cleared`.

## Rotation

1. Generate a new key in your provider dashboard.
2. Paste it into **Settings → BYOK** and save.
3. The old key is overwritten in Vault — the new key is active on the next LLM call.
4. Revoke the old key from your provider dashboard once you confirm calls are flowing.

## Langfuse trace attribution

Langfuse traces include a `key_source` property (`'tenant'` or `'platform'`) so you can filter your Langfuse dashboard by BYOK vs platform usage.
