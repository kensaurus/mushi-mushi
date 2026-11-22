# What leaves the browser

Source: https://kensaur.us/mushi-mushi/docs/security/what-leaves-the-browser

---
title: What leaves the browser
description: What the Mushi Mushi web SDK sends with a bug report, where each part is filtered, and how to keep private pages out of reports.
---

# What leaves the browser

> **Scenario:** You run a members-only community. Before you put the report widget on private group pages, you want to know what a report can carry and where it gets filtered.

All filtering happens **in the browser, before the report is sent**. The model you choose, hosted or local, only ever sees what already left. Anything the browser lets through is stored in your database.

## What a report carries

| Part | What is sent | Filtered in the browser |
| --- | --- | --- |
| **Description** | What the reporter typed | Pattern scrubber (below), then your `beforeSend` |
| **Screenshot** | An image of the page, only when one is attached | Redaction by selector before any pixel exists; the reporter reviews it (below) |
| **Console** | The last 50 `log`/`info`/`warn`/`error`/`debug` lines, each cut to 500 characters | Pattern scrubber |
| **Network** | Method, URL, status and timing of recent requests | Never reads request or response **bodies** or **headers**. Query values with sensitive names (`token`, `code`, `email`, `session`, `auth`, `key`, …) are replaced |
| **Breadcrumbs and tags** | Route changes, console lines, and your own breadcrumbs and tags | Pattern scrubber |
| **Selected element** | Tag name, id, class, XPath and up to 200 characters of its text, when the reporter points at one | No text at all from inside (or around) a private area; the rest goes through the pattern scrubber |
| **Replay** | Off unless you turn it on | `rrweb` masks all text and inputs; `lite` records only the tag and test id of clicks |

The server runs the same scrubber again on text fields when it stores a report.

## Screenshots

The reporter sees every screenshot before it is sent, and can blur parts of it (**Mark up**; the blur is written into the pixels) or **Remove** it.

| `capture.screenshot` | When the screenshot is taken |
| --- | --- |
| Not set | Only when the reporter presses the camera button |
| `'on-report'` | When the reporter presses **Send**. It is shown first; a second **Send** sends it |
| `'auto'` | When the report opens; shown while they write |
| `'off'` | Never; the camera button is hidden |

A screenshot the reporter removed is never taken again for that report.

**Always blacked out**, whatever you configure: password fields, card fields (`autocomplete="cc-…"`), and anything marked `data-private` or `data-mushi-mask`. Images and canvases inside them are never read.

  The scrubber reads text, not pictures. Words visible on screen, such as a private discussion, stay in the screenshot unless the element is marked or the reporter blurs it.

To keep a private area out of every screenshot, mark its container:

```html
<section class="group-discussion" data-private>…</section>
```

or list selectors in `init`:

```ts
Mushi.init({
  projectId: '…',
  apiKey: '…',
  privacy: {
    redactSelectors: ['.group-discussion', '.member-list'], // black box
    blockSelectors: ['.dm-thread'],                         // removed from the image
  },
})
```

To turn screenshots off on some pages only, call `Mushi.getInstance()?.updateConfig({ capture: { screenshot: 'off' } })` when the private page mounts, and set your usual mode again when it unmounts.

## The pattern scrubber

It replaces these before anything is sent:

- email addresses and phone numbers
- card numbers and US Social Security numbers
- JWTs and API keys from AWS, Stripe, Slack, GitHub, OpenAI, Anthropic and Google
- IP addresses, only when you turn them on (`ipAddresses`, `ipv6`)

It recognises patterns. A sentence copied from a private post into a `console.log` line is not a pattern and is sent as written. If your app logs user content, use `beforeSend` to drop or rewrite it:

```ts
Mushi.init({
  // …
  beforeSend: (report) => ({
    ...report,
    consoleLogs: report.consoleLogs?.filter((l) => !l.message.includes('post body')),
  }),
})
```

`beforeSend` runs after the scrubber and sees the whole report; return `null` to send nothing.

## Related

- [Bring-your-own storage](/security/byo-storage): keep screenshots in your own bucket
- [Self-hosting](/self-hosting/docker-compose): keep everything on your own server
- [Web SDK reference](/sdks/web)
