---
'@mushi-mushi/capacitor': patch
---

Fix `BreadcrumbCollector` iOS: clamp `maxMessageLength` floor to 1 instead of
50 so callers can request smaller buffers for tests and specialised use
cases. The previous `Swift.max(50, ...)` silently overrode any caller value
below 50 — undocumented hidden policy that broke
`BreadcrumbCollectorTests.testMessageTruncatedAtMaxLength`. Default
behaviour (`maxMessageLength: 500`) is unchanged for everyone who does not
pass an explicit small value. Also drop a now-unused
`ExceptionNormaliser` import in the Android `Mushi.kt`.
