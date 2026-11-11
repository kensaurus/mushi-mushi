# Lovable or Bolt quickstart (no terminal)

Source: https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt

---
title: Lovable or Bolt quickstart (no terminal)
description: Add a Mushi Mushi report button to a Lovable or Bolt app with one prompt and no terminal. What your users see, what it collects from them, and how to remove it.
---

# Mushi Mushi in Lovable or Bolt

You add Mushi Mushi the way you change anything else in Lovable or Bolt: with
a prompt. There is nothing to download. It takes about five minutes.

- Sign up free and copy one line.
- Ask Lovable or Bolt to add it to your app.
- Your app gets a report button. When a user reports a bug, Mushi Mushi tells you why it broke and gives you a prompt that fixes it.

### Copy your line

1. [Sign up free](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-lovable-bolt) and create a project. Name it after your app.
2. Click **Set up** in the sidebar.
3. Open the **Install widget** tab.
4. Pick the **Script tag** tab.
5. Copy the line it shows.

**You'll see:** a line that starts with `

### Paste it into Lovable or Bolt

Send this prompt in your project's chat. Put your own line from step 1 in
place of the example line.

```text
Add this script tag inside the <head> of index.html exactly as written, and change nothing else:
<script async src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js" data-project="YOUR_PROJECT_ID" data-key="YOUR_SDK_KEY"></script>
```

The line above is an example. Yours has your own project ID and key where
the capital letters are.

**You'll see:** a small report button in the corner of your app after it rebuilds.

### Publish and send a test report

1. Publish your app.
2. Open the live site.
3. Tap the report button.
4. Type one sentence, for example "Testing Mushi Mushi", and send it.

**You'll see:** the report in your [Mushi Mushi console](https://kensaur.us/mushi-mushi/admin/reports) within seconds, with a title, how serious it is and the likely cause.

### Fix a real bug

1. When a user reports something, open the report in the console.
2. Click **Copy fix prompt**.
3. Paste it into Lovable or Bolt.

The prompt says what broke, why, where, and how to check the fix.

**You'll see:** Lovable or Bolt make a change aimed at the cause. Check it in the preview before you publish.

Not sure what a diagnosis looks like? [Read a sample](/demo/diagnosis): a
user's complaint, what the report button captured, the cause and the fix prompt.

## What your users will see

- **A small button** in the corner of your app.
- **A short form** when they tap it. They pick what kind of problem it is and type one sentence. They need no account.
- **A Screenshot button.** It attaches a picture of the page. They see the picture before they send it, and they can remove it.
- **A Send button.** After that they are done.

This clip shows it on a small demo shop:

## What it collects from your users

When someone sends a report, Mushi Mushi gets:

- **What they typed.**
- **A picture of the screen,** if they attached one. Password boxes and card-number boxes are blacked out in the picture. Anything else on the screen is in it, so the form asks them to check the preview first.
- **Where they were:** the page address, their browser, and the size of their screen.
- **What the app was doing just before:** up to 50 recent error messages and log lines, the address and result of up to 30 recent requests the page made (not what was in them), and their recent taps and page changes.
- **Two IDs with no name in them:** a random ID kept in their browser, so repeat reports from one person group together, and a scrambled code made from their browser and screen details, used to spot abuse.

It does not ask for a name or an email address. If your app prints private
details in its own error messages, those lines can be in a report.

When someone only visits and sends nothing, the script tag still counts the
visit: which pages were opened and when, with a random ID. It skips browsers
that ask not to be tracked (Do Not Track or Global Privacy Control). The
button also checks in with Mushi Mushi when a page loads, which records your
site's address (not the page) and the browser type.

**How long it is kept.** On the free plan, reports and everything attached to
them are deleted after 14 days. Paid plans keep them longer:
[the privacy policy](/legal/privacy#7-retention) has the table.

**Tell your users.** You must tell them that reports can include a
screenshot and error logs. If your app has a privacy note, add this sentence:

```text
This app uses Mushi Mushi to collect bug reports. When you send a report, it includes what you write, a screenshot you can remove before sending, the page address, your browser type and recent error logs. It also counts page visits with a random ID.
```

## How to remove it

1. Ask Lovable or Bolt: "Remove the Mushi Mushi script tag from index.html."
2. Publish your app. The report button is gone and nothing more is sent.
3. To delete what was already collected, open **Manage apps** in the console's sidebar and click the bin icon next to your project. You type the project's short name to confirm, and you have 8 seconds to undo. This deletes its reports and keys.
4. To delete your whole account, email [kensaurus@gmail.com](mailto:kensaurus@gmail.com) from the address you signed up with.

## Read reports inside Lovable

You can also connect Mushi Mushi to Lovable's chat, so you can ask "what did users
report today?" and get the diagnosis without opening the console. See
[Mushi Mushi as a Lovable connector](/quickstart/lovable-mcp).

## Is the key safe in my page?

Yes. The key in your line can only send reports to your project. It cannot
read reports, change settings or see other projects. That is why it can sit
in your page, like the key of any chat or analytics tool.

  Paste only the line from the **Script tag** tab. Every Mushi Mushi key starts with
  `mushi_`, so the start does not tell them apart. Never put a key you made
  for an editor into your app, because those keys can read your reports.

## Change how the button looks

The line takes a few settings, such as `data-position` and `data-theme`. The
full list is on the [script-tag reference](/quickstart/web#no-bundler-script-tag).

## If nothing shows up

- **Your line says `YOUR_SDK_KEY`:** the key is not filled in yet. On the
  **Script tag** tab, click **Generate API key** in the **Mint your API key**
  box above the line. If there is no such box, click **Rotate** next to your
  key in the same card. The real key fills in. Copy the line again.
- **No button:** ask Lovable or Bolt to show you the `` of
  `index.html` and check the line is there, unchanged. Then publish again.
- **Your project has no `index.html`** (a Next.js app, for example): ask it to
  add the same line to the page `` of the root layout instead.
- **Button, but no report in the console:** check that `data-project` and
  `data-key` in your app match the Script tag tab exactly, with no spaces.
- **Still stuck:** the [troubleshooting list](/quickstart#troubleshooting)
  covers the other cases.
