---
"@mushi-mushi/web": patch
---

Fix rewards activity tracker double-wrapping `history.pushState` on re-init (stack overflow). `Mushi.destroy()` now tears down rewards listeners.
