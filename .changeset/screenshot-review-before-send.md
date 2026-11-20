---
"@mushi-mushi/web": minor
---

- **A screenshot is never sent without the reporter seeing it.** With `capture.screenshot: 'on-report'`, pressing Send took the screenshot and sent it in the same moment, so the reporter never saw it. Send now takes it, shows it with Mark up and Remove and the line "Check the screenshot below, then press Send again", and the second Send sends it.
- **A removed screenshot stays removed.** With `'auto'` or `'on-report'`, pressing Remove and then Send took a new screenshot and sent it. Remove now holds until that report is sent or closed.
- **The selected element's text follows the privacy rules.** Pointing at an element sent up to 200 characters of its text unscrubbed, even inside `data-private`. Text from inside (or around) a redacted, masked or blocked area is now left out, and the rest goes through the PII scrubber.
