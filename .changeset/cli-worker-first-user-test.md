---
'@mushi-mushi/cli': minor
---

`mushi work --daemon` runs the first-time user test the console queues (Run now on the First-time user test page). Any lane of the app takes it before its own work, so a worker you already run needs no new lane. It starts `mushi-ux fresh-eyes` with Node, never a shell, and passes the start page, goal and any test accounts on stdin, never in arguments. The heartbeat says the worker runs these tests, and a lane asks for work within a minute when one waits.
