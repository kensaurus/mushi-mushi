---
"@mushi-mushi/web": patch
---

Screenshots attached to reports now show what the user was looking at.

- **Scroll position:** the capture shows the part of the page the user had scrolled to, including pages that scroll inside an app shell (`<main>`) and sticky headers. It used to always show the top of the page.
- **Layout:** sections above the viewport keep their live size, so the visible part no longer drifts out of frame on long pages. Each stylesheet's own text is used, in document order. Chrome's CSSOM dropped `font: … var()` shorthands, and the old order broke `@layer` cascades. CSS-in-JS rules added with `insertRule` are kept.
- **Images and canvases:** they are embedded at their natural size and keep transparency, so pixel sprites no longer turn into black boxes. Running animations keep their current frame. Unreadable media becomes a grey box of the same size.
- **Pages that failed outright:** pages with a `--` comment, framework attribute names (`@click`, `:href`) or control characters in text no longer fail with reason `error`.
- **Speed and size:** off-screen media is never read. The capture code is a separate chunk that loads with the first screenshot, so the core bundle is smaller (88.5 KB budget).
