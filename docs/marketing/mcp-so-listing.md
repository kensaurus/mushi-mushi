# mcp.so listing — field map

Edit: `https://mcp.so/my-servers/ddf3465a-1aa9-4e8b-ad5c-c28119600a51/edit`

Canonical URLs: [`canonical-urls.md`](./canonical-urls.md)

| Field | Public surface | Value |
| --- | --- | --- |
| **Title** | Page heading | `Mushi Mushi` |
| **Description** | Subtitle under `@kensaurus` | Your AI shipped it. Mushi tells you why it broke — plain diagnosis and a paste-ready fix prompt in Cursor. No second LLM key. |
| **Content** | Overview tab | Unnamed `<textarea>` (4th on form, index 3) — not TipTap; paste markdown below |
| **Server Config** | Right rail | JSON below |

## Server Config (paste verbatim)

```json
{
  "mcpServers": {
    "mushi-mushi": {
      "command": "npx",
      "args": ["-y", "@mushi-mushi/mcp@latest"],
      "env": {
        "MUSHI_API_KEY": "<YOUR_MUSHI_API_KEY>",
        "MUSHI_PROJECT_ID": "<YOUR_PROJECT_UUID>",
        "MUSHI_API_ENDPOINT": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api",
        "MUSHI_FEATURES": "triage,fixes,inventory,setup,docs"
      }
    },
    "mushi-mushi-hosted": {
      "type": "http",
      "url": "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp?features=triage,fixes,inventory,setup,docs",
      "headers": {
        "Authorization": "Bearer <YOUR_MUSHI_API_KEY>",
        "X-Mushi-Project-Id": "<YOUR_PROJECT_UUID>"
      }
    }
  }
}
```

## Overview tab (Content editor)

1. Sign in as `kenji` → open edit URL above.
2. Fill **Content** — the textarea under the "Content" label (no `name` attribute; 4th textarea on the form).
3. Paste overview markdown below, submit, hard-refresh [mcp.so/server/mushi-mushi](https://mcp.so/server/mushi-mushi).

```markdown
## Why it broke — in your editor

Mushi turns user-felt bugs into a plain diagnosis and a paste-ready fix prompt. Works from Cursor, Claude Code, or VS Code over MCP.

**Install:** [kensaur.us/mushi-mushi/docs/connect](https://kensaur.us/mushi-mushi/docs/connect) · `npx mushi-mushi setup --ide cursor`

**Tools:** triage reports, `get_fix_context`, QA story runs, codebase search (when indexed).

No second LLM key. Free tier covers triage + fix context.
```
