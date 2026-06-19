---
"@mushi-mushi/core": patch
"@mushi-mushi/web": patch
---

Fix offline-queue retry loop and widget back-navigation state, harden widget HTML escaping.

- **core/queue**: A transient submit failure whose bumped attempt-counter could
  not be persisted (e.g. an IndexedDB write error) previously re-flushed the row
  forever, bypassing `MAX_DELIVERY_ATTEMPTS` until the 24h age sweep. Row
  mutation now goes through backend-aware `removeRow`/`persistRow` helpers (no
  silent cross-backend no-op), and a report whose counter can't be saved is
  dropped immediately instead of looping (Sentry 14751132/0).
- **web/widget**: Pressing Back to the category step now collapses an
  expanded "more issue types" list instead of leaving it open across navigation
  (Sentry 14751132/1).
- **web/widget-render**: `aria-label`, `placeholder`, and the header eyebrow
  now route their interpolated locale strings through `escapeHtml`, closing a
  latent XSS vector if a translation contains markup.
