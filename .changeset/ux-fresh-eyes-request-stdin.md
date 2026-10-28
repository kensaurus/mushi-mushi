---
'@mushi-mushi/ux': minor
---

`mushi-ux fresh-eyes --request-stdin` reads a run the console queued (its id, start page, goal, visitors and test accounts) as JSON on stdin, so a local worker passes nothing in arguments. `--dry-run --sync` now shows the run in the console, marked look around only; it still writes nothing to your app and files nothing. A failed console sync exits with code 1.

Fixes from the first live run on Mushi:

- The model reads a page's main content first, then its navigation, so a long docs sidebar no longer hides the article. Controls a mouse user cannot see, such as a "Skip to content" link, are left out, and a click always goes to the copy you can see.
- A click that opens a window on the app (a sign-in popup) is followed. A window outside the app is closed and noted.
- An opinion that the page shows nothing, or only a menu, is not filed when the page's main content has text.
- Waiting for content no longer counts small pulsing dots, such as a notification badge, as loading. Real skeletons, spinners and progress bars still count. A wait that hits its cap is marked on its step and never counted as the app's time.
- With a test account, the default is 60 steps (30 without). The minted account's user id is printed in the log and the timeline, never its password.
- The terminal setup runs in a home folder of its own, so it cannot replace the CLI login on the machine.
