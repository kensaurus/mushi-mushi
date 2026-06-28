---
"@mushi-mushi/core": patch
---

Fix `startAutoSync` in the offline queue leaking an `online` event listener and `setInterval` when called more than once (e.g. config reload). Calling `startAutoSync` a second time now stops the previous sync loop before starting a fresh one.
