# Mushi Mushi for VS Code

> **Your AI wrote it. Mushi tells you why it broke.**

One-click [Model Context Protocol](https://modelcontextprotocol.io/) server for
VS Code agent mode. Pull a plain-English diagnosis and a paste-ready fix prompt
for any user-felt bug — plus evidence (screenshots, console, network), blast
radius, and fix dispatch — without leaving the editor and **without a second
LLM key**.

## Install

1. Install this extension from the VS Code Marketplace or [Open VSX](https://open-vsx.org/).
2. Open the **Chat** view → **Agent** mode. Mushi registers itself as an MCP
   server automatically.
3. The first time the agent uses a Mushi tool you'll be prompted for an API key.
   Get one from the [Mushi console](https://kensaur.us/mushi-mushi/admin) → **Connect &
   Update → Add to VS Code**, or run **`Mushi Mushi: Use the read-only demo`**
   from the Command Palette to try it with no signup.

## Try it with no signup

Run **`Mushi Mushi: Use the read-only demo (no signup)`** from the Command
Palette (`Ctrl/Cmd+Shift+P`). This connects to a public, read-only demo project
seeded with synthetic reports so you can see the tools work end-to-end. It is
locked to `?read_only=1` and a safe feature subset — it can read nothing of real
users and write nothing.

## Commands

| Command | Description |
| --- | --- |
| `Mushi Mushi: Set API key` | Store your key securely in VS Code SecretStorage. |
| `Mushi Mushi: Clear API key` | Remove the stored key. |
| `Mushi Mushi: Use the read-only demo (no signup)` | Switch to the public demo project. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `mushiMushi.transport` | `stdio` | `stdio` runs `npx @mushi-mushi/mcp` locally; `http` connects to the hosted Streamable HTTP endpoint. |
| `mushiMushi.endpoint` | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` | Mushi API base URL (`MUSHI_API_ENDPOINT`) for the stdio transport. Point at your self-hosted edge functions if you are not on Mushi Cloud. |
| `mushiMushi.mcpHttpUrl` | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp` | Hosted Streamable HTTP MCP URL for the `http` transport. |
| `mushiMushi.projectId` | — | Optional Mushi project UUID. |
| `mushiMushi.features` | `triage,fixes,inventory,setup,docs` | Comma-separated MCP feature groups to expose. Use `all` for every tool. |
| `mushiMushi.useDemo` | `false` | Use the public read-only demo project. |
| `mushiMushi.demoApiKey` | — | Public `mcp:read` demo key used when **Use demo** is on. |

## Self-hosting

Not on Mushi Cloud? Set `mushiMushi.endpoint` / `mushiMushi.mcpHttpUrl` to your
own Supabase edge functions and use a key minted from your own console. See the
[self-host guide](https://kensaur.us/mushi-mushi/docs/).

## Links

- [Documentation](https://kensaur.us/mushi-mushi/docs/)
- [Connect your editor](https://kensaur.us/mushi-mushi/docs/connect)
- [GitHub](https://github.com/kensaurus/mushi-mushi)

Licensed MIT.
