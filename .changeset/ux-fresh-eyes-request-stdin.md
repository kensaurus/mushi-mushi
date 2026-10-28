---
'@mushi-mushi/ux': minor
---

`mushi-ux fresh-eyes --request-stdin` reads a run the console queued (its id, start page, goal, visitors and test accounts) as JSON on stdin, so a local worker passes nothing in arguments. `--dry-run --sync` now shows the run in the console, marked look around only; it still writes nothing to your app and files nothing. A failed console sync exits with code 1.
