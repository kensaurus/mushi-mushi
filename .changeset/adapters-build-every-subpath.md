---
'@mushi-mushi/adapters': patch
---

The `sentry`, `bugsnag`, `rollbar`, `crashlytics`, `firebase-analytics`, `cloudwatch` and `opsgenie` subpath imports now resolve. They were declared in `exports` but never built, so importing any of them failed with a module-not-found error.
