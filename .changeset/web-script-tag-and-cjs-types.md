---
'@mushi-mushi/web': patch
---

`unpkg` and `jsdelivr` now point at `dist/mushi.loader.global.js`, so `https://cdn.jsdelivr.net/npm/@mushi-mushi/web@1` and `https://unpkg.com/@mushi-mushi/web@1` serve the self-initialising script-tag loader instead of the CommonJS bundle, which throws inside a `<script>` tag.

The exports map nests `types` under `import` and `require`, so CommonJS consumers get the `.d.cts` declarations instead of ESM types (the "masquerading as ESM" resolution error), and `typesVersions` resolves the `test-utils`, `i18n`, `otel` and `headless` subpaths under `moduleResolution: "node"`. The loader's 1.2 MB source map is no longer packed.
