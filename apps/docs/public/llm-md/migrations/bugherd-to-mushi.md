# BugHerd → Mushi Mushi

Source: https://kensaur.us/mushi-mushi/docs/migrations/bugherd-to-mushi

---
title: 'BugHerd → Mushi Mushi'
description: Move from BugHerd to Mushi Mushi. Map pin-to-element feedback to Mushi's element picker, screenshot markup and metadata capture, with an interactive checklist.
---

# BugHerd → Mushi Mushi

 

BugHerd's signature feature is **pixel-pin annotations**: clients click
on a part of a web page to attach a comment to that exact element. Mushi
Mushi gives similar element-level context: in the web widget the reporter
can pick an element, and the report records its tag, id / class, XPath
and position, next to a screenshot they can mark up.

  Mushi doesn't replicate BugHerd's Kanban task board. If your
  client-feedback workflow depends on the Kanban view, plan for a workflow
  change as well as a tool change.

## Why switch

- **Open source.** Mushi's SDKs are MIT; its server and admin console are
  AGPLv3.
- **Self-host.** Mushi runs on your own infrastructure.
- **AI triage.** Mushi categorises and prioritises reports automatically,
  which helps when client feedback is noisy.
- **Developer context.** Reports carry console and network logs, so a
  developer can often reproduce the bug without asking the client.

## API mapping

| BugHerd | Mushi |
|---------|-------|
| `` | `` mounting `Mushi.init({ projectId, apiKey })` |
| Sidebar widget (always visible) | The Mushi launcher (by default a floating button on desktop, an edge tab on phones), opens on click |
| Element click → annotation | User opens the widget → picks an element, marks up the screenshot |
| `window.BugHerdConfig = { reporter: { email } }` | `mushi.setUser({ id, email, name })` |
| Project task board | Mushi admin console, Reports page |
| Hiding sensitive content from screenshots | Add `data-mushi-redact` to the element (or list selectors in `privacy.redactSelectors`) |

## Before / After

```html
<!-- BEFORE — BugHerd -->
<script type="text/javascript">
  (function(d,t) {
    var bh = d.createElement(t); bh.async = true;
    bh.type = 'text/javascript';
    bh.src = 'https://www.bugherd.com/sidebarv2.js?apikey=YOUR_API_KEY';
    var s = d.getElementsByTagName(t)[0]; s.parentNode.insertBefore(bh, s);
  })(document, 'script');
</script>
```

```html
<!-- AFTER — Mushi (web) -->
<script type="module">
  import { Mushi } from 'https://esm.sh/@mushi-mushi/web'
  const mushi = Mushi.init({
    projectId: 'YOUR_PROJECT_ID',
    apiKey:    'YOUR_PUBLIC_KEY',
  })  // default launcher: floating button on desktop, edge tab on phones
  // later, once you know the client: mushi.setUser({ id, email, name })
</script>
```

For React / Vue / Svelte / Next, use the framework-specific SDK instead.

## Migration checklist

Sign in to the Mushi admin console; copy projectId + apiKey.</> },
    { id: 'install', label: 'Install or script-tag Mushi', content: {`# CDN, for the same script-tag setup BugHerd had:

  import { Mushi } from 'https://esm.sh/@mushi-mushi/web'
  Mushi.init({ projectId: '...', apiKey: '...' })

# Or via npm:
npm install @mushi-mushi/web`} },
    { id: 'mount-mushi', label: 'Add Mushi alongside BugHerd', content: <>Both can coexist for a few days while you train clients on the new UX.</> },
    { id: 'redact', label: 'Mark sensitive elements with data-mushi-redact', content: {`<!-- Blacked out in Mushi screenshots -->

<!-- Password inputs and autocomplete="cc-*" fields are always redacted -->`} },
    { id: 'identify-user', label: 'Wire client identity (mushi.setUser)', content: <>If you passed the reporter&apos;s email to BugHerd through BugHerdConfig.reporter, call {`mushi.setUser({ id, email, name })`} on the instance from Mushi.init(). Useful when the same client reports across several pages.</> },
    { id: 'client-comms', label: 'Tell clients about the new widget', content: <>The biggest difference: BugHerd's sidebar is always visible. Mushi's widget is a floating button (an edge tab on phones) that opens on click. Send clients a one-line note so they know what to look for.</> },
    { id: 'verify', label: 'Submit a test report from a real page', content: <>Open the widget, pick an element, write a description, and confirm the screenshot and element details are attached and the report lands in the Mushi admin console.</> },
    { id: 'remove-bugherd', label: 'Remove the BugHerd script + revoke the API key', content: <>Once clients are on Mushi for ≥ a week, pull the script tag and revoke BugHerd's API key in their dashboard.</> },

/>

## Feature parity

| Capability | BugHerd | Mushi |
|------------|---------|-------|
| User-triggered report | ✅ | ✅ |
| Screenshot capture | ✅ | ✅ |
| Element context | ✅ (pixel pin) | ✅ (picked element: tag, id / class, XPath, position) |
| Console + network capture | not checked | ✅ |
| Sidebar / always-visible | ✅ | ❌ (floating button) |
| Project Kanban board | ✅ | ❌ (report inbox + filters) |
| Client guest accounts | ✅ | ❌ (anonymous reports OK; named clients via `setUser`) |
| Visual annotations on screenshot | ✅ | ✅ (highlight, blur, arrow; web) |
| Self-host | not checked | ✅ |
| AI triage | not checked | ✅ |

If pinning comments to exact spots on the page is central to your client
workflow, BugHerd is built around that and may suit you better.

## References

- [Mushi web SDK](/sdks/web)
- [BugHerd support](https://support.bugherd.com/)
- [BugHerd: pre-populate the reporter's email](https://support.bugherd.com/en/articles/33899-public-feedback-tab-how-to-pre-populate-the-reporter-s-email-address)
