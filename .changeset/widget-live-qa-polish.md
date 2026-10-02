---
"@mushi-mushi/web": patch
---

Widget polish from live QA on Windows Chrome:

- Screenshots work in Chrome again. Chrome taints the canvas when a foreignObject SVG is loaded from a `blob:` URL, so every capture failed; the capture now uses a `data:` URL, which also passes CSPs whose `img-src` allows `data:` but not `blob:`. When the host's CSP blocks `data:` too, the reason reads "This site's security policy blocks screenshots."
- The "Mushi SDK x · latest is y · Update @mushi-mushi/web" notice no longer appears to end users. Under the default `outdatedBanner: 'auto'` it shows only on a dev host (localhost, loopback, `*.localhost`, `*.local`, `file:`) or with `debug: true`. `'banner'` still shows it everywhere; the console warning is unchanged.
- The report thread no longer sits on "Loading thread…" forever: reporter inbox reads time out after 15 s, and a failed load shows an error with "Try again". The reply composer is pinned in a footer, so Reply can no longer be clipped off the bottom of the panel.
- A background re-render (runtime config, rewards, inbox poll) no longer swallows a click: renders are deferred while a pointer is down inside the panel.
- Feature requests now send `userCategory: 'feature'`, so they land as `reports.user_category = 'feature'` instead of a generic `other`, whether they come from the ✨ card or from Other → Feature request. A host's custom category id still wins. The details step's placeholder and starter chips follow the mode: feature, bug or other.
- The shortcut hint reads "Ctrl + Enter" outside Apple platforms and is localized.
- The description counter shows "N more characters" until the minimum is met, then `length/4000`. It used to show length over the minimum, such as "397/12".
- A failed screenshot shows why: permission blocked, browser unsupported, blocked by another site's content, blocked by the site's security policy, timed out, or generic. The button becomes "Try again". The `mushi:screenshot_failed` document event can now carry `timeout`, `unsupported` and `csp`; these used to arrive as `error`.
- The success step is titled "Thanks — report received". A rate-limited, queued or failed send gets its own title instead. The step shows the receipt id and a localized date-time with time zone, has a Done button and no Back button, and no longer closes itself after 2.8 s.
- "Track this report" opens that report's thread in My Reports. It is hidden when there is no reporter inbox, or no report id yet.
- The stylesheet's comments and the indentation of the CSS and HTML templates are stripped at build time; both used to ship inside string literals that no minifier touches.
