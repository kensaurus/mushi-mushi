---
'@mushi-mushi/vue': patch
---

The README's setup is one call: `app.use(MushiPlugin, { projectId, apiKey })`. The old README called the plugin API-only and told you to install `@mushi-mushi/web` and call `Mushi.init()` as well, but the plugin already depends on `@mushi-mushi/web` and initialises the widget itself.
