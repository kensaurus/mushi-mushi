# In-SDK Ask assistant

Source: https://kensaur.us/mushi-mushi/docs/sdks/assistant

---
title: In-SDK Ask assistant
---

# In-SDK Ask assistant

The Mushi widget can show an **Ask** tab so end users get answers grounded in
the current page context and an operator-authored knowledge corpus — using your
BYOK LLM key, with every turn logged.

This is the public summary. Operator deep-dive (security model, schema, API):
[`docs/SDK_ASSISTANT.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_ASSISTANT.md)
in the monorepo.

## What it does

- End users ask questions about the screen they are on.
- Answers are grounded **only** in SDK-published page context + your knowledge
  corpus (no cross-user RAG in v1).
- `POST /v1/sdk/assistant` — rate-limited, BYOK via Anthropic/OpenAI, structured
  `{ kind: 'answer' | 'clarify', … }` replies.
- Turns are audited in `sdk_assistant_messages`.

## Enable it

1. In the admin console → project → SDK / Assistant settings, turn the assistant
   on and set greeting / label / suggestion chips.
2. Optionally author a knowledge corpus (secret-scanned, 40k char cap).
3. Ensure a BYOK Anthropic or OpenAI key is configured for the project.
4. Ship a host SDK that includes the Ask tab (`@mushi-mushi/web` **1.19+** and
   framework wrappers that depend on it).

`GET /v1/sdk/config` returns the `assistant` block so the widget can show the
tab without a rebuild when you toggle it in the console.

## SDK surface (host app)

Publish page context so answers stay on-topic:

```ts
mushi.publishPageContext({
  route: location.pathname,
  title: document.title,
  summary: 'Checkout — payment step',
})
```

Open the Ask tab programmatically when useful:

```ts
mushi.openAssistant()
```

Exact method names follow the web SDK; see the package README and
[`docs/SDK_ASSISTANT.md`](https://github.com/kensaurus/mushi-mushi/blob/master/docs/SDK_ASSISTANT.md)
for the full contract.

## Security (short)

- No per-user data fetch from the assistant path.
- System prompt forbids secrets / source / env disclosure.
- Knowledge corpus is secret-scanned on write.
- Optional `X-Mushi-User-Token` is audit-only.
