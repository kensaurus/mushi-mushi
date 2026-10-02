---
"@mushi-mushi/web": patch
---

Screenshots no longer come out blank on pages with entrance animations. CSS animations never run inside the SVG image the capture draws, so elements with fade-in keyframes stayed at opacity 0 and the whole capture was transparent ("This browser can't capture the page"). The capture now freezes animations and transitions after every page style, so it shows the settled page the reporter sees. The capture canvas also asks for `willReadFrequently`, which silences Chrome's Canvas2D readback warning.
