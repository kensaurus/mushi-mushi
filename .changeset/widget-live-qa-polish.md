---
"@mushi-mushi/web": patch
"@mushi-mushi/core": patch
---

Widget polish from live QA on Windows Chrome:

- Screenshots work in Chrome again. Chrome taints the canvas when a foreignObject SVG is loaded from a `blob:` URL, so every capture failed; the capture now uses a `data:` URL, which also passes CSPs whose `img-src` allows `data:` but not `blob:`. When the host's CSP blocks `data:` too, the reason reads "This site's security policy blocks screenshots."
- After a failed capture the reporter can choose "Share this tab instead": a user-consented `getDisplayMedia` tab capture that grabs one frame and stops the share at once. It loads on demand, as does screenshot markup: the ESM build now code-splits those two into `dist/chunks/`.
- Screenshots always black out `input[type="password"]`, `input[autocomplete^="cc-"]`, `[data-private]` and `[data-mushi-mask]` before any pixel exists, in both the DOM capture and the tab share. `privacy.redactSelectors` now adds to that baseline, replacing only the `[data-mushi-redact]` default; previously a host's own list silently dropped password redaction.
- The "Mushi SDK x · latest is y · Update @mushi-mushi/web" notice no longer appears to end users. Under the default `outdatedBanner: 'auto'` it shows only on a dev host (localhost, loopback, `*.localhost`, `*.local`, `file:`) or with `debug: true`. `'banner'` still shows it everywhere, and `'console-only'` keeps it out of the widget; the console warning is unchanged.
- Report threads no longer sit on "Loading thread…" forever. Core's reporter-inbox requests go through the same client path as every other call, with a timeout and retries, and resolve `{ ok: false }` instead of hanging or rejecting. They stay outside the circuit breaker in both directions, so a flaky inbox can never push report submissions into the offline queue. Reporter replies are no longer replayed on `pagehide`.
- The thread paints its summary at once and shows comment placeholders while the comments load. A load failure shows an error with "Try again". Replies, fix confirmations and reopens keep the conversation on screen and stay on the thread; their errors appear beside the composer. The composer is pinned in a footer, so Reply can't be clipped.
- A background re-render (runtime config, rewards, inbox poll) no longer swallows a click: renders are deferred while a pointer is down inside the panel.
- Feature requests now send `userCategory: 'feature'`, so they land as `reports.user_category = 'feature'` instead of a generic `other`, whether they come from the ✨ card or from Other → Feature request. A host's custom category id still wins. The details step's placeholder and starter chips follow the mode: feature, bug or other.
- The shortcut hint reads "Ctrl + Enter" outside Apple platforms and is localized.
- The description counter shows "N more characters" until the minimum is met, then `length/4000`. It used to show length over the minimum, such as "397/12".
- A failed screenshot shows why: permission blocked, browser unsupported, blocked by another site's content, blocked by the site's security policy, timed out, or generic. The button becomes "Try again". The `mushi:screenshot_failed` document event can now carry `timeout`, `unsupported` and `csp`; these used to arrive as `error`.
- The success step is titled "Thanks — report received". A rate-limited, queued or failed send gets its own title instead. The step shows the receipt id and a localized date-time with time zone, has a Done button and no Back button, and no longer closes itself after 2.8 s.
- "Track this report" opens that report's thread in My Reports. It is hidden when there is no reporter inbox, or no report id yet.
- The stylesheet's comments and insignificant whitespace, and the HTML templates' indentation, are stripped at build time; they used to ship inside string literals that no minifier touches.
