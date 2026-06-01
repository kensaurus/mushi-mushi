---
'@mushi-mushi/web': patch
---

fix(widget): remove body nudge on all banner early-return paths + destroy()

Two bugs where the banner body-nudge (paddingTop/paddingBottom + CSS custom
property set by applyBodyNudge) was left behind after the banner was removed:

1. `renderBanner()` now calls `removeBodyNudge()` before returning early when
   `triggerVisible` is false (e.g. after `sdk.hide()`) or when the current
   route matches `hideOnRoutes`. Previously only the `bannerDismissed` early
   return called removeBodyNudge; the other two paths left host-page padding
   permanently altered.

2. `destroy()` now calls `removeBodyNudge()` before removing the host element.
   A widget destroyed while banner mode was active left the document root's
   `--mushi-banner-offset` CSS property and body padding-top/bottom in place.
