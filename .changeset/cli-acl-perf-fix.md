---
"@mushi-mushi/cli": patch
---

Performance: cache Windows ACL tightening — `whoami` result and already-tightened file paths are now memoised per process. Previously every `saveConfig` call ran `whoami` + `icacls` (≈500ms each on Windows), causing multi-profile test suites and repeated CLI invocations to hit timeouts. Single-profile users see no change (ACLs still applied on first save).
