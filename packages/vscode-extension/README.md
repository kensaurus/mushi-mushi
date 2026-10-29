# Mushi Mushi for VS Code

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

For people who fix bugs in VS Code's agent mode. This extension registers the
Mushi Mushi [MCP](https://modelcontextprotocol.io/) server, so the agent can
pull a plain-English diagnosis and a fix prompt for a bug a user reported,
with its evidence (screenshots, console, network), its blast radius, and a way
to start a fix, without you leaving the editor.

> **Status: deferred (2026-09-21).** This extension is **not published** to the
> VS Code Marketplace or Open VSX, and will not be until the hosted MCP sign-in
> it defaults to is fixed. You do not need it to use Mushi in VS Code: open
> [Connect your editor](https://kensaur.us/mushi-mushi/docs/connect), pick
> **VS Code** and open its one-click install dialog, which adds the Mushi MCP
> server with VS Code's built-in MCP support.

## Install (from source)

1. Build the package from a clone of this repository:
   `pnpm --filter mushi-mushi-vscode package`, then in VS Code run
   **Extensions: Install from VSIX…** and pick the generated `.vsix`.
2. Open the **Chat** view → **Agent** mode. Mushi registers itself as an MCP
   server automatically.
3. The first time the agent uses a Mushi tool you'll be prompted for an API key.
   Mint a key with the `mcp:read` scope on the **Projects** page of the
   [Mushi console](https://kensaur.us/mushi-mushi/admin) (API keys).

## Read-only demo mode

**`Mushi Mushi: Use the read-only demo (no signup)`** switches the extension
to a read-only demo project, locked to `?read_only=1` and a safe feature
subset, so it can read nothing of real users and write nothing. It needs a
demo key in `mushiMushi.demoApiKey`; the extension does not ship one, so
until a public demo key is published this mode shows a "no demo key is set"
message.

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
| `mushiMushi.endpoint` | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api` | Mushi API base URL (`MUSHI_API_ENDPOINT`) for the stdio transport. Point at your self-hosted edge functions if you are not on Mushi Mushi Cloud. |
| `mushiMushi.mcpHttpUrl` | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/mcp` | Hosted Streamable HTTP MCP URL for the `http` transport. |
| `mushiMushi.projectId` | (empty) | Optional Mushi project UUID. |
| `mushiMushi.features` | `triage,fixes,inventory,setup,docs` | Comma-separated MCP feature groups to expose. Use `all` for every tool. |
| `mushiMushi.useDemo` | `false` | Use the public read-only demo project. |
| `mushiMushi.demoApiKey` | (empty) | `mcp:read` demo key used when **Use demo** is on. None ships with the extension. |

## Self-hosting

Not on Mushi Cloud? Set `mushiMushi.endpoint` / `mushiMushi.mcpHttpUrl` to your
own Supabase edge functions and use a key minted from your own console. See the
[self-host guide](https://kensaur.us/mushi-mushi/docs/self-hosting).

## Links

- [Documentation](https://kensaur.us/mushi-mushi/docs/)
- [Connect your editor](https://kensaur.us/mushi-mushi/docs/connect)
- [GitHub](https://github.com/kensaurus/mushi-mushi)

Licensed MIT.
