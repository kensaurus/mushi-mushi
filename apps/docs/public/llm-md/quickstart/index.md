# Quickstart — fix your first bug in 60 seconds

Source: https://kensaur.us/mushi-mushi/docs/quickstart

---
title: Quickstart — fix your first bug in 60 seconds
description: Install Mushi with npx mushi-mushi, connect Cursor or Claude Code over MCP, and turn user bug reports into plain-English diagnoses with ready fixes.
---

# Quickstart

- One command, `npx mushi-mushi`, adds a report button to your app.
- When a user reports a bug, Mushi writes a plain-English diagnosis.
- Your AI editor reads it and writes the fix.

### Install

Run this in your app's folder. It finds your framework, signs you in through
your browser, installs the SDK and writes your settings to `.env.local`.

```bash
npx mushi-mushi
```

**You'll see:** a report button in your app, and a new project in the [console](https://kensaur.us/mushi-mushi/admin).

### Send your first report

Tap the report button in your app and write one sentence. Or say yes when the
wizard offers to send a test report.

**You'll see:** the report in the console with a title, severity and likely cause, in about 10 seconds.

### Get your first fix

Connect your AI editor. One click on the [Connect page](https://kensaur.us/mushi-mushi/docs/connect), or:

```bash
npx mushi-mushi setup --ide cursor
```

Then ask your editor: *"Get the latest Mushi report and fix it."*

**You'll see:** a fix brief in your editor: the cause, the files to change and how to check it. You review the change before it ships.

## Pick your framework

The wizard detects your framework for you. Pick yours to see what it installs
and the one line it adds to your code.

- **Mobile previews:** [iOS](/quickstart/ios) · [Android](/quickstart/android) · [Flutter](/quickstart/flutter), installed from the GitHub repo.
- **Go deeper:** [Incident loop](/quickstart/incident-loop) · [MCP server](/quickstart/mcp) · [CLI console loop](/quickstart/cli-console-loop)

What you need first

- An app you are building, for the web or for phones.
- A Mushi account. The free plan is enough, and the wizard signs you in through your browser.
- Optional: an AI code editor such as Cursor or Claude Code.

`npx` runs a tool from npm (the public library of JavaScript packages) without
installing it for good. Here it runs the Mushi setup wizard.

## Keys and settings

Setting it up yourself? See [Project ID & API keys](/concepts/credentials) for the setting names each framework expects.

  The SDK needs only two settings: your project ID and API key, named with the
  prefix your framework expects (see
  [`examples/sdk.env.example`](https://github.com/kensaurus/mushi-mushi/blob/master/examples/sdk.env.example)).
  The repo's root `.env.example` is only for **running the Mushi server
  yourself**. You do not need Supabase or an AI (LLM) key to use the SDK.

## Troubleshooting
