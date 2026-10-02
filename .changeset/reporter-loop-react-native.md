---
"@mushi-mushi/react-native": minor
---

The report sheet now looks like part of the host app: a new `widget.theme` prop (bg, fg, muted, surface, border, accent, accentFg, success, error, fontFamily, radius) replaces the hard-coded neon header and the "MUSHI · BETA" strip, with neutral ink-accent defaults. Category chips wrap at their natural width instead of squeezing five into one row ("Confus-ing"). "Your reports" uses the shared status vocabulary from `@mushi-mushi/core/reporter-ui`, so RN and web show the same labels. Threads show a skeleton while loading and Retry when a load fails or does not answer in 12 s, replies keep their text and offer Retry on failure, and opening a thread marks its updates read. Chips, Submit, tabs and the drag handle carry accessibility roles and states, and the sheet is modal to VoiceOver. New instance methods: `loadMyThread(reportId)` (null on failure) and `markReportRead(reportId)`.
