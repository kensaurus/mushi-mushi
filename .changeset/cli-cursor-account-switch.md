---
'@mushi-mushi/cli': minor
---

The local worker can switch its Cursor account when you ask from the console (Pipeline → Workers → Switch account). It stops taking new work, lets the runs in progress finish, signs the Cursor CLI out, starts `cursor-agent login` without a browser and sends the approve link to the console, where only you see it; after you approve it on cursor.com it checks which account it is and reports signed in, wrong account, expired or failed. The account you name in the console replaces `cursorAccount` from `worker.json`. No key or password reaches the machine, and the link never appears in a log line.
