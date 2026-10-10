---
"@mushi-mushi/web": patch
---

`identifyWithToken()` sends a SHA-256 of the token's `sub` as the session `user_id_hash`, not the raw subject, and clears it on logout.
The shared history patch wraps whatever `history.pushState` / `replaceState` was installed before it, so a host router or analytics wrapper keeps seeing navigations and is restored on teardown.
An `XMLHttpRequest.send()` that throws synchronously no longer leaves its correlation id stamped on every later console entry.
A `screenshotProvider` result that is not a `data:image/` URL, such as a native `file://` URI, is ignored with a warning instead of being attached and dropped by the server.
A report the user opened themselves no longer resets the proactive prompts' dismissal streak.
If the rewards activity listeners fail part-way through setup, the next init installs them again instead of skipping them for the rest of the session.
`Mushi.init()` accepts a config without `projectId` / `apiKey` (`MushiInitConfig`) when env vars supply them, and the widget's recorder hooks are tagged `@internal`.
`avoidSelectors` only moves the widget away from elements in the half of the viewport it is anchored to, so an avoided top header no longer pushes the default bottom-anchored trigger and panel off-screen (and a bottom tab bar no longer does the same to a top-anchored one).
