---
'@mushi-mushi/web': minor
'@mushi-mushi/core': minor
'@mushi-mushi/react': minor
---

Bug-capture widget redesign — "Mushi Mushi Editorial" (2026-04-24)

The floating widget has been redesigned end-to-end to lean into the brand
(虫々 = "bug, bug" in Japanese) instead of the generic SaaS chatbot look it
shipped with. No API or config changes — purely visual + a few quality-of-life
keyboard wins.

**Visual**

- Paper + sumi ink palette (`#F8F4ED` cream / `#0E0D0B` ink) replaces the
  previous purple-on-white. Single 朱 vermillion accent (`#E03C2C`) used as
  a hanko stamp colour.
- Trigger is now a rounded paper card with a vermillion bottom edge and a
  pulsing 朱 dot — reads as a real 印鑑 stamp, not a floating round button.
- System serif display stack (Iowan/Palatino/Georgia) for headings; mono
  for the new `01 / 03` step-counter ledger and the "REPORT · HH:MM:SS"
  receipt timestamp. Zero web-font fetches.
- Editorial contents-list category step (1px hairline rules, no card
  stacking), arrow-on-hover cues, vermillion focus underline.
- Success step renders a 朱印 ring with the kanji `受` ("received").
- All design tokens are named by **material** (`paper`, `ink`, `rule`,
  `vermillion`) rather than role (`primary`, `secondary`).

**Keyboard / a11y**

- New `⌘ / Ctrl + Enter` shortcut submits from anywhere in the panel.
- Footer hint advertises the shortcut.
- Textarea autofocus on the details step (one fewer Tab to start typing).
- `prefers-reduced-motion` is fully honoured — animations collapse to
  instant, success stamp jumps to the final frame.
- Panel gets `aria-modal="true"`; trigger advertises `aria-haspopup` /
  `aria-expanded`.

**Reliability**

- `MushiWidget.destroy()` now clears the success-state and auto-close
  timers, preventing a host that unmounts mid-submit from holding a
  reference to the destroyed widget for ~3.3s.
