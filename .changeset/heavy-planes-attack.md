---
'@mushi-mushi/web': minor
'@mushi-mushi/cli': patch
---

Screenshots and the element picker now work on real-world pages: same-origin stylesheets are inlined into the capture (SVG-in-img loads no subresources), silent WebKit failures degrade to "no screenshot" via a decode timeout and blank-canvas detection, and the picker uses a full-viewport capture layer with `elementsFromPoint` and shadow-root descent so iframes and shadow DOM are selectable. When a screenshot is shed for payload size, `report()` returns `screenshotDropped: true` and the widget receipt says so instead of dropping it silently. CLI setup now resolves IDE config directories with `path.isAbsolute`, fixing Zed setup on Windows.
