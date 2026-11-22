# Framework wrappers (Vue / Svelte / Angular)

Source: https://kensaur.us/mushi-mushi/docs/sdks/framework-wrappers

---
title: Framework wrappers (Vue / Svelte / Angular)
description: How mushi-mushi/vue, /svelte and /angular wrap the web SDK, how each one boots the SDK once, and where to find capture and widget options.
---

# Framework wrappers

The Mushi Mushi entry points `mushi-mushi/vue`, `mushi-mushi/svelte`, and
`mushi-mushi/angular` are thin idiomatic shells over [`mushi-mushi`](/sdks/web).
Each one wraps the web SDK and calls `Mushi.init` once, so do not call
`Mushi.init` a second time.

| Import | Boot | Docs |
| --- | --- | --- |
| [`mushi-mushi/vue`](/sdks/vue) | `app.use(MushiPlugin, config)` | [Quickstart](/quickstart/vue) |
| [`mushi-mushi/svelte`](/sdks/svelte) | `initMushi(config)` | [Quickstart](/quickstart/svelte) |
| [`mushi-mushi/angular`](/sdks/angular) | `providers: [provideMushi(config)]` (1.0.3+; factory providers on 1.0.2 and earlier) | [Quickstart](/quickstart/angular) |

For capture, widget triggers, runtime config, and privacy, read the
[web SDK](/sdks/web). React has its own entry point: [`mushi-mushi/react`](/sdks/react).
