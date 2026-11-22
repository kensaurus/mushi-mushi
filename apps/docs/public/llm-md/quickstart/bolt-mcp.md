# Ask Bolt why it broke

Source: https://kensaur.us/mushi-mushi/docs/quickstart/bolt-mcp

---
title: Ask Bolt why it broke
description: Add Mushi Mushi to Bolt as a custom MCP connector, sign in once, and ask Bolt what users reported. Bolt reads the plain-English diagnosis and fixes the bug.
---

# Ask Bolt why it broke

A user says your app is broken. Ask Bolt *"what did my users report?"* and it
reads Mushi Mushi's diagnosis of each report, gets the fix prompt and fixes
the code.

- Add Mushi Mushi in Bolt as a custom MCP connector: one URL, sign in, approve.
- Turn the connector on in your project.
- Ask in the chat: "what did my users report?"

You need a Mushi Mushi project that receives reports. No report button in
your app yet? Add it with one prompt first:
[Mushi Mushi in Lovable or Bolt](/quickstart/lovable-bolt).

### Open your connectors

On the Bolt home page, click the **+** in the chatbox, then
**Connectors** → **Manage connectors**
([Bolt docs](https://support.bolt.new/integrations/mcp)).

### Add Mushi Mushi as a custom MCP server

Click **Custom MCP server** and fill in the form:

| Field | Value |
| --- | --- |
| **Name** | `Mushi Mushi` |
| **URL** | `https://kensaur.us/mushi-mushi/hosted-mcp/?features=vibe` |
| **Transport type** | `HTTP` |
| **Authentication** | `MCP OAuth` |

Click **Connect**.

### Sign in and approve

A Mushi Mushi page opens. Sign in, choose which projects Bolt may see, and
click **Approve**. You never copy a key, and you can revoke this connection
from the Mushi Mushi console at any time.

**You'll see:** a **Connected** status at the top right of the connector page.

### Turn it on in your project

Open your project, click the **+** in the chatbox, then **Connectors**, and
switch Mushi Mushi on. Or tick **Auto-enable for all projects** on the
connector page.

### Ask Bolt

```text
Using the Mushi Mushi connector, what did my users report this week?
```

```text
Get the Mushi Mushi fix context for the top report and fix it.
```

No reports yet? Ask for a test one:

```text
Using Mushi Mushi, file a test report: "The Save button on the settings page does nothing."
```

**You'll see:** the report, the likely cause in plain English and the files to change, then Bolt's edit.

## Which tools Bolt gets

The `?features=vibe` part of the URL keeps the list to the 12 tools a builder
uses: list and search reports, read one, get the fix prompt, mark it fixed,
reply to the reporter, file a report, a setup check and the docs. Bolt turns
every tool on by default. To stop Bolt changing anything, open the connector,
click **⋯** → **Edit**, and untick `transition_status`, `reply_to_reporter`
and `file_report`.

  Bolt notes that many connectors at once can slow it down. Turn Mushi Mushi
  on only in the projects that need it.

## If it does not connect

- **Use the `kensaur.us` URL above.** The sign-in needs it; a `supabase.co`
  URL fails the OAuth lookup.
- **Pick `MCP OAuth`, not `API key`.** An API key works too, but it must be
  an `mcp:read` key, never the key in your app's script tag.
- **Still stuck:** ask Bolt to call `diagnose_setup`. It says what is missing.
