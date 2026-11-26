/**
 * FILE: packages/web/src/widget-icons.ts
 * PURPOSE: The report screen's inline SVG icons (ADR 0070): one per report
 *          type plus the attachment, privacy and send glyphs. Drawn for this
 *          widget on a 24px grid, stroked in `currentColor` so a tile's type
 *          colour (or the panel ink) paints them. Decorative only: every
 *          control that shows one also carries a text label or aria-label.
 */

const PATHS = {
  bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8a3 3 0 0 1 6 0M12 12v8M3 13h4M17 13h4M4 7l3 2.5M20 7l-3 2.5M4 20l3-2.5M20 20l-3-2.5"/>',
  slow: '<path d="M3.5 18a8.5 8.5 0 1 1 17 0"/><path d="M12 18l-4.5-5"/><circle cx="12" cy="18" r="1.2"/>',
  visual: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  confusing: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5V14M12 17.5v.01"/>',
  idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.4.6.9.6 1.5V16h6v-.7c0-.6 0-1.1.6-1.5A6 6 0 0 0 12 3z"/>',
  other: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
} as const;

export type WidgetIconName = keyof typeof PATHS;

/** An inline SVG icon, hidden from assistive tech. */
export function icon(name: WidgetIconName, cls = 'mushi-ico'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Built-in report types that carry their own colour and icon. */
export const TYPE_ICON_IDS: ReadonlySet<string> = new Set(['bug', 'slow', 'visual', 'confusing', 'idea', 'other']);
