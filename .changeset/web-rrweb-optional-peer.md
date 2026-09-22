---
'@mushi-mushi/web': patch
'@mushi-mushi/core': patch
---

Session replay with rrweb works in bundled apps, and rrweb is no longer installed for everyone.

- **New `capture.rrweb` loader.** Pass `capture: { replay: 'rrweb', rrweb: () => import('rrweb') }`. The SDK used to load rrweb with a runtime import that no bundler can see, so in a bundled app replay quietly fell back to recording clicks only. Your own dynamic import is code-split like any other. A global `rrweb` from the UMD script tag still works without a loader, and when `replay: 'rrweb'` cannot load rrweb the SDK now warns once in the console.
- **Rendered text is masked.** rrweb 2.x ignores the `maskAllText` option the SDK passed, so page text would have been recorded in clear. Replay now masks every text node and every input, and blocks `privacy.redactSelectors` (plus password fields and `[data-mushi-redact]`) from the recording.
- **`rrweb` is an optional peer dependency.** As an optional dependency it was downloaded with every install of `@mushi-mushi/web`, about 8 MB of replay code most apps never load. Apps that use `replay: 'rrweb'` now install it themselves: `npm install rrweb`.
