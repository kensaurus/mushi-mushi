---
'@mushi-mushi/core': patch
'@mushi-mushi/react-native': patch
---

SDK fixes from automated code review.

- **Favicon trust boundary** (`@mushi-mushi/core`): `readPageFaviconHref` now returns only http(s) URLs, so a host page can't get a `data:` / `blob:` / `javascript:` favicon rendered into the widget's `<img src>`; anything else falls back to the default mark.
- **Self-hosted credential message** (`@mushi-mushi/core`, `@mushi-mushi/react-native`): the one-time 401/403 "credentials rejected" warning only links to the hosted console when the client is actually using the Cloud endpoint; self-hosted deployments get a console-agnostic message instead of a wrong domain.
- **Offline-queue data loss** (`@mushi-mushi/react-native`): `decryptQueueBlob` now decrypts any blob carrying the encrypted prefix regardless of the current `secureStorage` flag. Previously, toggling `secureStorage` from `true` to `false` returned the still-encrypted string, which failed `JSON.parse` and silently cleared the offline report queue.
