# Mushi in Lovable or Bolt

Source: https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt

---
title: Mushi in Lovable or Bolt
description: Add Mushi to a Lovable or Bolt app without a terminal. Paste one script tag through your prompt, then read each bug's plain-English cause and fix prompt.
---

# Mushi in Lovable or Bolt

Lovable and Bolt build your app from a chat, with no terminal, so `npx` is
not an option. You add Mushi the way you change anything else there: with a
prompt. It takes about five minutes.

- Sign up free and copy your script tag.
- Ask Lovable or Bolt to add it to your app.
- When a user reports a bug, Mushi tells you why and gives you a prompt that fixes it.

### Get your script tag

[Sign up free](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-lovable-bolt)
and create a project. On the setup page, in **Configure & install the SDK**,
pick the **Script tag** tab. Your project ID is already in the tag. If the
key still reads `mushi_xxx`, click **Generate API key** in the box above it
(elsewhere in the console the button reads **Mint SDK key**) and the real key
fills in. Then copy the tag.

**You'll see:** a tag that starts with `

### Paste it into Lovable or Bolt

Send this prompt in your project's chat, with your tag from the step above in
place of the example tag:

```text
Add this script tag inside the <head> of index.html exactly as written, and change nothing else:
<script async src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js" data-project="YOUR_PROJECT_ID" data-key="YOUR_API_KEY"></script>
```

If your project has no `index.html` (a Next.js app, for example), ask it to
add the same tag to the page `` of the root layout instead.

**You'll see:** a small report button in the corner of your app after it rebuilds.

### Publish and send a test report

Publish the app, open the live site, tap the report button and write one
sentence, for example "Testing Mushi".

**You'll see:** the report in your [Mushi console](https://kensaur.us/mushi-mushi/admin/reports) within seconds, with a title, how serious it is and the likely cause.

### Fix a real bug

When a user reports something, open the report in the console and click
**Copy fix prompt**. Paste it into Lovable or Bolt. The prompt says what
broke, why, where, and how to check the fix.

**You'll see:** Lovable or Bolt make a change aimed at the cause. Check it in the preview before you publish.

Not sure what a diagnosis looks like? [Read a sample](/demo/diagnosis): a
user's complaint, what the widget captured, the cause and the fix prompt.

## Read reports inside Lovable

You can also connect Mushi to Lovable's chat, so you can ask "what did users
report today?" and get the diagnosis without opening the console. See
[Mushi as a Lovable connector](/quickstart/lovable-mcp).

## Where the key goes, and is it safe?

The key in the tag is an SDK key. It can only send reports to your project
(`report:write`); it cannot read reports, change settings or see other
projects. That is why it can sit in your page's HTML, like any analytics or
chat-widget key.

  Paste only the tag from the **Script tag** tab. Every Mushi key starts with
  `mushi_`, so the prefix does not tell them apart: never put a key you made
  for an editor or the MCP server into your app, because those keys can read
  your reports.

## Change how the button looks

The tag takes a few `data-*` settings, such as `data-position` and
`data-theme`. The full list is on the
[script-tag reference](/quickstart/web#no-bundler-script-tag).

## If nothing shows up

- **No button:** ask Lovable or Bolt to show you the `` of
  `index.html` and check the tag is there, unchanged. Then publish again.
- **Button, but no report in the console:** check that `data-project` and
  `data-key` match the Script tag tab exactly, with no spaces.
- **Still stuck:** the [troubleshooting list](/quickstart#troubleshooting)
  covers the other cases.
