---
"@mushi-mushi/web": patch
---

Reports now keep the error that caused a bug. Uncaught errors and unhandled promise rejections are recorded in the console log: an exception thrown in an event handler never passes through `console.*`, so it was missing. An `Error` passed to `console.error` (for example `console.error("save failed", err)`) is recorded as its name and message with its stack, where it used to be stored as `{}`.
