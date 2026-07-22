# BugHerd → Mushi

Source: https://kensaur.us/mushi-mushi/docs/migrations/bugherd-to-mushi

---
title: 'BugHerd → Mushi'
---

# BugHerd → Mushi

 

BugHerd's signature feature is **pixel-pin annotations** — clients click
on a part of a web page to attach a comment to that exact element. Mushi
provides similar element-level context via its capture pipeline (the
report includes the clicked element's CSS selector, position, and a
screenshot) plus structured user metadata.

  Mushi doesn't replicate BugHerd's collaborative-Kanban board feature. If
  your client-feedback workflow depends on the Kanban view, plan for a
  workflow change as well as a tool change. Most teams find Mushi's report
  inbox + admin console sufficient.

## Why switch

- **Open source.** Mushi's SDK + admin console are MIT-licensed.
- **Self-host.** Mushi runs on your infrastructure; BugHerd is SaaS-only.
- **AI triage.** Mushi categorises, prioritises, and assigns reports
  automatically — handy when client feedback is noisy.
- **Single inbox.** Mushi consolidates internal-team and client feedback
  into one project; BugHerd siloes per-website projects.

## API mapping

| BugHerd | Mushi |
|---------|-------|
| `` | `` mounting `Mushi.init({ projectId, apiKey })` |
| Sidebar widget (always visible) | Floating button widget (`widget.trigger: 'button'`) — discreet, opens on click |
| Element click → annotation | User triggers widget → screenshot + element selector capture |
| `bugherd.identify(user)` | `Mushi.setUser({ id, email, name })` |
| Project-board view | Mushi admin console — Reports tab |
| `data-bugherd-private` (skip element from screenshots) | `data-mushi-redact` (same idea) |

## Before / After

```html
<!-- BEFORE — BugHerd -->

  (function(d,t) {
    var bh = d.createElement(t); bh.async = true;
    bh.type = 'text/javascript';
    bh.src = 'https://www.bugherd.com/sidebarv2.js?apikey=YOUR_API_KEY';
    var s = d.getElementsByTagName(t)[0]; s.parentNode.insertBefore(bh, s);
  })(document, 'script');

```

```html
<!-- AFTER — Mushi (web) -->

  import { Mushi } from 'https://esm.sh/@mushi-mushi/web'
  Mushi.init({
    projectId: 'YOUR_PROJECT_ID',
    apiKey:    'YOUR_PUBLIC_KEY',
    widget:    { trigger: 'button' },  // BugHerd-equivalent UX
  })

```

For React / Vue / Svelte / Next, use the framework-specific SDK instead.

## Migration checklist

Sign in to the Mushi admin console; copy projectId + apiKey.</> },
    { id: 'install', label: 'Install or script-tag Mushi', content: {`# CDN — for the same script-tag UX BugHerd had:

  import { Mushi } from 'https://esm.sh/@mushi-mushi/web'
  Mushi.init({ projectId: '...', apiKey: '...' })

# Or via npm:
npm install @mushi-mushi/web`} },
    { id: 'mount-mushi', label: 'Add Mushi alongside BugHerd', content: <>Both can coexist for a few days while you train clients on the new UX.</> },
    { id: 'redact', label: 'Port any data-bugherd-private to data-mushi-redact', content: {`<!-- Anywhere BugHerd had -->

<!-- Switch to -->
`} },
    { id: 'identify-user', label: 'Wire client identity (Mushi.setUser)', content: <>If you previously passed user info to BugHerd, mirror with {`Mushi.setUser({ id, email, name })`}. Useful when the same client reports across several pages.</> },
    { id: 'client-comms', label: 'Tell clients about the new widget', content: <>The biggest difference: BugHerd's sidebar is always visible. Mushi's widget is a discreet floating button that expands on click. Send a 1-line email so clients know what to look for.</> },
    { id: 'verify', label: 'Submit a test report from a real page', content: <>Click the floating bug, write a description, confirm the screenshot + element selector are attached, confirm it lands in the Mushi admin console.</> },
    { id: 'remove-bugherd', label: 'Remove the BugHerd script + revoke the API key', content: <>Once clients are on Mushi for ≥ a week, pull the script tag and revoke BugHerd's API key in their dashboard.</> },
  ]}
/>

## Feature parity

| Capability | BugHerd | Mushi |
|------------|---------|-------|
| User-triggered report | ✅ | ✅ |
| Screenshot capture | ✅ | ✅ |
| Element selector context | ✅ (pixel pin) | ✅ (CSS selector + position) |
| Console + network capture | ✅ | ✅ |
| Sidebar / always-visible | ✅ | ❌ — discreet floating button |
| Project Kanban board | ✅ | ❌ — flat report inbox + filters |
| Client guest accounts | ✅ | ❌ — anonymous reports OK; named clients via `setUser` |
| Visual annotations on screenshot | ✅ | ❌ — text + selector only |
| Self-host | ❌ | ✅ |
| Open source | ❌ | ✅ |
| AI triage | ❌ | ✅ |

If pixel-perfect visual annotations on screenshots are critical to your
client workflow, BugHerd is genuinely better at that one thing. Most
teams find Mushi's selector + screenshot combination sufficient and the
AI triage saves more time than they lose on annotations.

## References

- [Mushi web SDK](/sdks/web)
- [BugHerd JS API docs](https://support.bugherd.com/)
