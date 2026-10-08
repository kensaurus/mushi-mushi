---
'@mushi-mushi/web': patch
---

Pages using the widget no longer fail to build under Turbopack (Next 16's default dev bundler) with "Module not found: Can't resolve 'rrweb'". The optional session-replay import is now marked `webpackIgnore`, which both webpack and Turbopack leave to the runtime, so apps without `rrweb` installed load normally and replay stays off.
