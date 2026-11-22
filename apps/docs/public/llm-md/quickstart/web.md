# Bug report widget for vanilla JavaScript

Source: https://kensaur.us/mushi-mushi/docs/quickstart/web

---
title: Bug report widget for vanilla JavaScript
description: "Free, open-source bug report widget for any website, no framework needed: install mushi-mushi or paste one script tag, then add your project key."
---

# Bug report widget for vanilla JavaScript

This page adds a report button to a site with no framework, or to any
framework you'd rather drive from plain JavaScript. When something breaks,
your users tap it and write one sentence. You get the likely cause in plain
English, with a fix your AI editor can apply.

- **Plain HTML, WordPress, Webflow or no build step?** Paste one
  [script tag](#no-bundler-script-tag). Nothing to install.
- **A JavaScript project with a `package.json`?** Run `npx mushi-mushi` in its
  folder. It gets your keys, installs the package and offers to add the
  start-up code to your entry file, such as `src/main.ts` (it asks first).

## Try it live

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **Fastest:** run `npx mushi-mushi` in your app's folder. It signs you in
  through the browser, creates or picks a project, installs the SDK and writes
  both values to `.env.local`.
- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-web)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

Put them in `.env.local` as `VITE_MUSHI_PROJECT_ID` and `VITE_MUSHI_API_KEY`.
With the script tag, they go in `data-project` and `data-key` instead.

## 1. Install

```bash
pnpm add mushi-mushi
```

## 2. Initialize

```ts filename="src/mushi.ts"
import { Mushi } from 'mushi-mushi'

export const mushi = Mushi.init({
  projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
  apiKey: import.meta.env.VITE_MUSHI_API_KEY,
})
```

## 3. Submit

```ts filename="src/report-button.ts"
import { mushi } from './mushi'

document.querySelector('#report-bug')?.addEventListener('click', async () => {
  await mushi.captureEvent({
    description: 'Login button does nothing on mobile Safari.',
    severity: 'medium',
  })
})
```

`captureEvent` files the report without opening any UI. To open the widget
instead, call `mushi.report()`.

**You'll see:** the report in the [console](https://kensaur.us/mushi-mushi/admin) within seconds, with a title, how serious it is and the likely cause.

The report button shows automatically after `Mushi.init`. Set
`widget: { trigger: 'hidden' }` to keep it out of sight and open it only
from your own buttons.

## No bundler: script tag

On a site with no build step (plain HTML, Rails or Django templates,
WordPress, Webflow), paste one tag into `` instead of installing the
package:

```html filename="index.html"
<script async
  src="https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1/dist/mushi.loader.global.js"
  data-project="YOUR_PROJECT_ID"
  data-key="YOUR_API_KEY"
></script>
```

The file is the loader that `@mushi-mushi/web` publishes to npm, served by
jsDelivr and pinned to major version 1, so minor and patch releases reach
you without editing the tag. It reads its settings from its own `data-*`
attributes and calls `Mushi.init` once; including the tag twice does not
start a second copy. With no `data-project` and `data-key` it does nothing.

| Attribute | Maps to |
| --- | --- |
| `data-project` | `projectId` (required) |
| `data-key` | `apiKey` (required; an SDK key with the `report:write` scope) |
| `data-trigger` | `widget.trigger` |
| `data-theme` | `widget.theme` |
| `data-position` | `widget.position` |
| `data-trigger-text` | `widget.triggerText` |
| `data-banner-variant` | `widget.bannerConfig.variant` (`neon`, `brand` or `subtle`) |
| `data-banner-position` | `widget.bannerConfig.position` (`top` or `bottom`) |
| `data-endpoint` | `apiEndpoint`, for a self-hosted server |
| `data-debug` | `debug` when set to `"true"` |

Anything else (capture options, `beforeSend`, `captureEvent` from your own
code) needs the npm package above. The console's **Script tag** install tab
prints this tag with your project ID and key filled in.

  See [SDK reference → mushi-mushi](/sdks/web) for the full config
  surface (PII scrubbing, rate limits, custom triggers, on-device pre-filter).
