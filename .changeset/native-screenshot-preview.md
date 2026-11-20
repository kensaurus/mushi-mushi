---
"@mushi-mushi/capacitor": minor
---

- **`report()` no longer sends a screenshot the reporter never saw.** On iOS and Android it captured the screen at submit. It now sends only the `screenshot` you pass: take one with `captureScreenshot()` before your form opens, show it there, and pass what the reporter keeps.
- **`captureScreenshot()` works on Android.** It always returned `null`; it now returns a base64 JPEG of the current screen.
- **The native bottom sheet (`useNativeWidget`) shows its screenshot** with a Remove button; only a screenshot still shown is sent.
