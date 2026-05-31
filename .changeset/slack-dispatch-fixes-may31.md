---
"@mushi-mushi/web": patch
---

**Banner & Slack dispatch fixes**

- Banner dismiss button is now more visible (increased opacity, padding, hover background).
- Body nudge (`paddingTop` / `paddingBottom`) is applied correctly so host-app content doesn't slide under a top- or bottom-positioned banner.
- Fixed: `EdgeRuntime.waitUntil` is now used in the Slack interactions handler so the background dispatch promise is not killed when the HTTP response returns. Previously the Deno isolate was terminated before the `fix_dispatch_jobs` insert landed, silently dropping every Slack-triggered fix dispatch.
