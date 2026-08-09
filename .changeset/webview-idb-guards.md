---
'@mushi-mushi/core': patch
---

Guard the offline-queue IndexedDB `onupgradeneeded` handlers against broken
WebView implementations (Facebook/Instagram iOS in-app browsers): `open()`
can fire upgradeneeded with a null `result`, or with an already-aborted
versionchange transaction, making `objectStoreNames` access throw a
TypeError and `createObjectStore` throw InvalidStateError — both escaped as
uncaught global errors in host apps (TSUMAGOI-28 / TSUMAGOI-29). The
handlers now guard + swallow, `onsuccess` verifies the store actually
exists before resolving, and the queue falls back to localStorage.
