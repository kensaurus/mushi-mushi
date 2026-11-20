import type { MushiPrivacyConfig } from '@mushi-mushi/core';
import { ALWAYS_REDACT_SELECTORS, type ScreenshotFailureReason } from './screenshot';

/**
 * The DOM capture itself, loaded on demand (the first screenshot) so it costs
 * nothing in the core bundle. The page is cloned, made safe and self-contained,
 * serialised into an SVG <foreignObject>, drawn on a canvas and exported.
 */
export async function captureDomScreenshot(
  privacy: MushiPrivacyConfig | undefined,
  fail: (reason: ScreenshotFailureReason) => void,
): Promise<string | null> {
  const canvas = document.createElement('canvas');
  // Read back on a grid by isCanvasBlank(); without this hint Chrome warns
  // about repeated getImageData readbacks.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    fail('unsupported');
    return null;
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const safeDocument = await buildPrivacySafeDocument(privacy);
  // XML forbids most C0 control characters even when escaped; one stray
  // U+0008 in page text made the whole SVG unparseable.
  const markup = new XMLSerializer().serializeToString(safeDocument).replace(XML_INVALID_CHARS, '');
  const svgData = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          ${markup}
        </div>
      </foreignObject>
    </svg>
  `;

  // data: URL, never blob:. Chrome (verified on 154) taints the canvas when
  // a foreignObject SVG arrives via a blob: URL, so toDataURL threw on every
  // capture; the same SVG as a data: URL exports cleanly (the approach
  // html-to-image uses). It also passes CSPs whose img-src allows data: but
  // not blob:. A CSP that blocks data: too is reported as 'csp'.
  const img = new Image();
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  let cspBlocked = false;
  const onViolation = (e: Event) => {
    const v = e as SecurityPolicyViolationEvent;
    if (/^img-src|^default-src/.test(v.violatedDirective ?? '') && /^data/.test(v.blockedURI ?? '')) cspBlocked = true;
  };
  document.addEventListener('securitypolicyviolation', onViolation);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: string | null, reason?: ScreenshotFailureReason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      document.removeEventListener('securitypolicyviolation', onViolation);
      if (reason) fail(reason);
      resolve(value);
    };
    // WebKit can leave the SVG image in limbo (neither load nor error) for
    // pathological documents — never let the report submit hang on it.
    const timer = setTimeout(() => settle(null, 'timeout'), 5000);

    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, width, height);
        // Safari/WebKit sometimes "loads" a foreignObject SVG but rasterises
        // nothing. A fully transparent canvas would export as a solid black
        // JPEG — report failure instead of attaching a useless image.
        if (isCanvasBlank(ctx, width, height)) {
          settle(null, 'unsupported');
          return;
        }
        settle(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        // Canvas tainted — return null so the report is submitted without a
        // screenshot rather than with a misleading gray placeholder.
        settle(null, 'taint');
      }
    };
    // The CSP violation event and the image error are separate queued
    // tasks with no guaranteed order — settle one task later so a
    // policy block is reported as 'csp', not a generic failure.
    img.onerror = () => setTimeout(() => settle(null, cspBlocked ? 'csp' : 'error'), 0);
    img.src = url;
  });
}

const XML_INVALID_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** An XML attribute name; HTML allows more (`@click`, `:href`, `[x]`), which made the SVG unparseable. */
const XML_ATTRIBUTE_NAME = /^[A-Za-z_][\w.:-]*$/;

/** Images inlined per capture, and their total size: a long photo grid must not stall the report. */
const MAX_INLINED_MEDIA = 60;
const MAX_INLINED_BYTES = 12 * 1024 * 1024;

const MEDIA_SELECTOR = 'img, video, canvas, iframe, object, embed';

export async function buildPrivacySafeDocument(privacy?: MushiPrivacyConfig): Promise<Element> {
  const live = document.documentElement;
  const clone = live.cloneNode(true) as Element;
  // Each <link> sheet's text goes where its <link> was (see inlineDocumentStyles).
  const liveLinks = live.querySelectorAll('link');
  const cloneLinks = clone.querySelectorAll('link');
  const linkSlots = new Map<Node, Element>();
  if (liveLinks.length === cloneLinks.length) liveLinks.forEach((l, i) => linkSlots.set(l, cloneLinks[i]!));
  const { offscreen, pins, backgrounds } = replayLiveState(live, clone);
  fillScriptedStyleElements(live, clone);

  // Pair live and cloned media before anything is removed: the clone keeps
  // the live document's element order, but not canvas pixels or image state.
  // Media inside anything redacted, masked or blocked never has its pixels read.
  const hidden = [
    ALWAYS_REDACT_SELECTORS,
    ...(privacy?.redactSelectors ?? DEFAULT_REDACT_SELECTORS),
    ...(privacy?.maskSelectors ?? []),
    ...(privacy?.blockSelectors ?? []),
  ];
  // Off-screen media is never read: it is not in the picture.
  inlineMedia(
    Array.from(live.querySelectorAll(MEDIA_SELECTOR)),
    Array.from(clone.querySelectorAll(MEDIA_SELECTOR)),
    (el) => offscreen.has(el) || hidden.some((selector) => matchesOrInside(el, selector)),
  );
  pinOffscreen(pins);
  await inlineBackgrounds(backgrounds.filter((bg) => !hidden.some((selector) => matchesOrInside(bg.live, selector))));

  // The SDK host is a zero-size pass-through shell — strip it from the
  // SVG foreignObject serialisation so capture doesn't fail on shadow DOM.
  clone.querySelector('#mushi-mushi-widget')?.remove();
  await inlineDocumentStyles(clone, linkSlots);
  stripTaintSources(clone);
  makeXmlSafe(clone);
  freezeMotion(clone);
  fillViewport(clone);

  // Redact: black-out matching elements, before mask/block. The always-on
  // baseline (passwords, card fields, [data-private], [data-mushi-mask]) runs
  // first; `redactSelectors` replaces only the [data-mushi-redact] default.
  const redactSelectors: readonly string[] = [
    ALWAYS_REDACT_SELECTORS,
    ...(privacy?.redactSelectors ?? DEFAULT_REDACT_SELECTORS),
  ];

  for (const selector of redactSelectors) {
    for (const el of safeQueryAll(clone, selector)) {
      redactElement(el as HTMLElement);
    }
  }

  for (const selector of privacy?.blockSelectors ?? []) {
    for (const el of safeQueryAll(clone, selector)) {
      el.remove();
    }
  }

  for (const selector of privacy?.maskSelectors ?? []) {
    for (const el of safeQueryAll(clone, selector)) {
      maskElement(el as HTMLElement);
    }
  }

  return clone;
}

const DEFAULT_REDACT_SELECTORS: readonly string[] = ['[data-mushi-redact]'];

/** Properties CSS animations commonly move; their current values are held in the capture. */
const ANIMATED_PROPERTIES = [
  'transform', 'translate', 'scale', 'rotate', 'opacity', 'visibility', 'clip-path',
  'object-position', 'background-position', 'left', 'top', 'width', 'height', 'color', 'background-color',
];

/**
 * The clone renders unscrolled and unanimated, so what the user was looking at
 * has to be replayed onto it: a report filed halfway down a page showed the
 * page's top, an app shell scrolling inside <main> showed its first screen,
 * and frozen animations snapped back (sprite sheets showed every frame).
 * Right after cloning, the clone mirrors the live tree, so document order
 * pairs the elements. One computed-style pass: ~7 ms for 1,700 elements.
 *
 * It also finds the subtrees wholly outside the viewport, to be pinned to
 * their live size (see pinOffscreen).
 */
function replayLiveState(live: Element, clone: Element): LiveState {
  const offscreen = new Set<Element>();
  const pins: Pin[] = [];
  const backgrounds: Background[] = [];
  const liveAll = [live, ...Array.from(live.querySelectorAll('*'))];
  const cloneAll = [clone, ...Array.from(clone.querySelectorAll('*'))];
  if (liveAll.length !== cloneAll.length) return { offscreen, pins, backgrounds };
  const animated = animationTargets();
  const styles: CSSStyleDeclaration[] = [];
  const scroller = document.scrollingElement;
  const pending = new Map<Element, Map<string, string>>();
  const set = (el: Element, prop: string, value: string) => {
    let decls = pending.get(el);
    if (!decls) pending.set(el, (decls = new Map()));
    decls.set(prop, value);
  };
  const scrolled: number[] = [];
  const withBackground: number[] = [];
  let inBody = false;

  for (let i = 0; i < liveAll.length; i++) {
    const liveEl = liveAll[i]!;
    const cloneEl = cloneAll[i]!;
    const computed = getComputedStyle(liveEl);
    styles.push(computed);
    if (liveEl === document.body) inBody = true;
    if (inBody) {
      // What hides an element on the page hides it in the capture. Rules
      // behind media queries the SVG evaluates differently (hover-only
      // controls under `(hover: hover)`) otherwise showed up.
      if (computed.display === 'none') set(cloneEl, 'display', 'none');
      else {
        const parent = liveEl.parentElement;
        if (computed.visibility !== 'visible' && parent && getComputedStyle(parent).visibility === 'visible') {
          set(cloneEl, 'visibility', computed.visibility);
        }
        if (computed.opacity === '0') set(cloneEl, 'opacity', '0');
        if (computed.backgroundImage.includes('url(')) withBackground.push(i);
      }
    }
    // Hold each running animation's current frame.
    if (animated.has(liveEl)) {
      for (const p of ANIMATED_PROPERTIES) set(cloneEl, p, computed.getPropertyValue(p));
    }
    // Sticky elements sit where the scroll put them, not at their flow spot.
    if (computed.position === 'sticky' && liveEl instanceof HTMLElement) {
      const offset = stickyOffset(liveEl);
      if (offset) {
        set(cloneEl, 'position', 'relative');
        set(cloneEl, 'top', `${offset.top}px`);
        set(cloneEl, 'left', `${offset.left}px`);
        set(cloneEl, 'bottom', 'auto');
        set(cloneEl, 'right', 'auto');
      }
    }
    if (liveEl !== scroller && (liveEl.scrollTop > 0 || liveEl.scrollLeft > 0)) scrolled.push(i);
  }

  // A scrolled container's content moves up by its scroll offset. Fixed
  // children stay put, as they do on the page.
  for (const i of scrolled) {
    const liveEl = liveAll[i]!;
    const liveKids = liveEl.children;
    const cloneKids = cloneAll[i]!.children;
    for (let j = 0; j < liveKids.length && j < cloneKids.length; j++) {
      const kid = getComputedStyle(liveKids[j]!);
      if (kid.position === 'fixed') continue;
      const own = pending.get(cloneKids[j]!)?.get('transform') ?? kid.transform;
      const shift = `translate(${-liveEl.scrollLeft}px, ${-liveEl.scrollTop}px)`;
      set(cloneKids[j]!, 'transform', own && own !== 'none' ? `${shift} ${own}` : shift);
    }
  }

  // The document's own scroll: offsetting the root (position:relative, not a
  // transform) moves the page while fixed elements stay on the viewport.
  if (window.scrollX || window.scrollY) {
    set(clone, 'position', 'relative');
    set(clone, 'top', `${-window.scrollY}px`);
    set(clone, 'left', `${-window.scrollX}px`);
  }

  for (const [el, decls] of pending) {
    const held = Array.from(decls, ([p, v]) => `${p}:${v}!important`).join(';');
    el.setAttribute('style', `${el.getAttribute('style') ?? ''};${held}`);
  }

  findOffscreen(liveAll, cloneAll, styles, offscreen, pins);
  for (const i of withBackground) {
    if (!offscreen.has(liveAll[i]!)) {
      backgrounds.push({ live: liveAll[i]!, clone: cloneAll[i]!, value: styles[i]!.backgroundImage });
    }
  }
  return { offscreen, pins, backgrounds };
}

interface LiveState {
  offscreen: Set<Element>;
  pins: Pin[];
  backgrounds: Background[];
}

interface Background {
  live: Element;
  clone: Element;
  /** Computed background-image: absolute url()s, possibly several layers. */
  value: string;
}

const MAX_BACKGROUND_URLS = 40;
const MAX_BACKGROUND_BYTES = 6 * 1024 * 1024;
const MAX_BACKGROUND_IMAGE_BYTES = 2 * 1024 * 1024;

/**
 * CSS background images (sprites, hero art, icons) are subresources, which an
 * SVG drawn as an image never loads, so they vanished. Like html-to-image,
 * fetch each one (from the HTTP cache the page just filled) and embed it as
 * a data: URL, for visible elements only and within a size budget. A URL
 * that can't be read (cross-origin without CORS, CSP connect-src) is left
 * for stripTaintSources to remove.
 */
async function inlineBackgrounds(backgrounds: Background[]): Promise<void> {
  const urls = new Map<string, Promise<string | null>>();
  let bytes = 0;
  const load = (url: string) => {
    let pending = urls.get(url);
    if (!pending) {
      pending = urls.size >= MAX_BACKGROUND_URLS
        ? Promise.resolve(null)
        : readAsDataUrl(url).then((data) => {
            if (!data || bytes + data.length > MAX_BACKGROUND_BYTES) return null;
            bytes += data.length;
            return data;
          });
      urls.set(url, pending);
    }
    return pending;
  };
  await Promise.all(
    backgrounds.map(async (bg) => {
      const refs = Array.from(bg.value.matchAll(CSS_URL), (m) => m[2]!.trim()).filter((u) => !u.startsWith('data:'));
      if (refs.length === 0) return;
      const data = await Promise.all(refs.map(load));
      let value = bg.value;
      refs.forEach((ref, k) => {
        if (data[k]) value = value.split(ref).join(data[k]!);
      });
      if (value !== bg.value) {
        bg.clone.setAttribute('style', `${bg.clone.getAttribute('style') ?? ''};background-image:${value}!important`);
      }
    }),
  );
}

const CSS_URL = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;

async function readAsDataUrl(url: string): Promise<string | null> {
  if (typeof fetch !== 'function') return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => abort?.abort(), SHEET_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: 'force-cache', signal: abort?.signal });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_BACKGROUND_IMAGE_BYTES || !blob.type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface Pin {
  clone: Element;
  width: number;
  height: number;
  marginTop: number | null;
  marginBottom: number | null;
}

const PINNABLE_DISPLAY = /^(block|flow-root|flex|grid|list-item|inline-block|inline-flex|inline-grid|table)$/;
const BLOCK_FLOW = /^(block|flow-root|list-item)$/;

/**
 * A subtree is off screen when neither it nor anything inside it (absolute
 * or fixed descendants included) meets the viewport. Only the topmost such
 * element is pinned; the rest of its subtree goes with it.
 */
function findOffscreen(
  liveAll: Element[],
  cloneAll: Element[],
  styles: CSSStyleDeclaration[],
  offscreen: Set<Element>,
  pins: Pin[],
): void {
  const bodyIndex = document.body ? liveAll.indexOf(document.body) : -1;
  if (bodyIndex < 0) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const index = new Map<Element, number>();
  const visible: boolean[] = new Array(liveAll.length).fill(false);
  // A box wholly outside the viewport. Boxless elements (empty, collapsed)
  // are neither: they show nothing and are never pinned on their own.
  const outside: boolean[] = new Array(liveAll.length).fill(false);
  for (let i = bodyIndex; i < liveAll.length; i++) index.set(liveAll[i]!, i);
  visible[bodyIndex] = true;
  // Children come after their parent in document order: walk backwards and
  // let each visible subtree mark its parent.
  for (let i = liveAll.length - 1; i > bodyIndex; i--) {
    const el = liveAll[i]!;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw) visible[i] = true;
      else outside[i] = true;
    }
    if (styles[i]!.position === 'fixed') visible[i] = true; // never pin fixed UI
    if (visible[i]) {
      outside[i] = false;
      const parent = el.parentElement ? index.get(el.parentElement) : undefined;
      if (parent !== undefined) visible[parent] = true;
    } else if (outside[i]) {
      offscreen.add(el);
    }
  }
  // Within a pinned subtree: its content is dropped with it.
  const covered: boolean[] = new Array(liveAll.length).fill(false);
  for (let i = bodyIndex + 1; i < liveAll.length; i++) {
    const el = liveAll[i]!;
    const parentIndex = el.parentElement ? index.get(el.parentElement) : undefined;
    if (parentIndex === undefined) continue;
    if (covered[parentIndex]) {
      covered[i] = true;
      continue;
    }
    if (!outside[i] || !(el instanceof HTMLElement)) continue;
    const s = styles[i]!;
    if (!PINNABLE_DISPLAY.test(s.display)) continue;
    covered[i] = true;
    // In block flow the gaps to the siblings are measured, so margins that
    // collapsed through this element's (now removed) children survive.
    const inFlow = BLOCK_FLOW.test(styles[parentIndex]!.display) && s.float === 'none' &&
      (s.position === 'static' || s.position === 'relative');
    pins.push({
      clone: cloneAll[i]!,
      width: el.offsetWidth,
      height: el.offsetHeight,
      marginTop: inFlow ? gapAbove(el) : null,
      marginBottom: inFlow ? gapBelow(el) : null,
    });
  }
}

function gapAbove(el: HTMLElement): number | null {
  const prev = el.previousElementSibling;
  if (!(prev instanceof HTMLElement) || prev.offsetParent !== el.offsetParent) return null;
  return Math.max(0, el.offsetTop - (prev.offsetTop + prev.offsetHeight));
}

function gapBelow(el: HTMLElement): number | null {
  const next = el.nextElementSibling;
  if (!(next instanceof HTMLElement) || next.offsetParent !== el.offsetParent) return null;
  return Math.max(0, next.offsetTop - (el.offsetTop + el.offsetHeight));
}

/**
 * Off-screen content is replaced by an empty box of its live size. The clone
 * cannot lay out exactly like the page (content-visibility, fonts that never
 * load in the SVG, heights set by script, lazy content), and every pixel of
 * difference above the viewport used to push the visible part out of frame:
 * one report showed a section 790 px below the one on screen. Pinned boxes
 * make everything above the viewport exactly as tall as on the page, and the
 * SVG no longer carries the whole page.
 */
function pinOffscreen(pins: Pin[]): void {
  for (const pin of pins) {
    pin.clone.replaceChildren();
    let pinned =
      `width:${pin.width}px!important;height:${pin.height}px!important;box-sizing:border-box!important;` +
      'min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;' +
      'content-visibility:visible!important;contain:none!important;';
    if (pin.marginTop !== null) pinned += `margin-top:${pin.marginTop}px!important;`;
    if (pin.marginBottom !== null) pinned += `margin-bottom:${pin.marginBottom}px!important;`;
    pin.clone.setAttribute('style', `${pin.clone.getAttribute('style') ?? ''};${pinned}`);
  }
}

function animationTargets(): Set<Element> {
  try {
    return new Set(
      document.getAnimations()
        .map((a) => (a.effect as KeyframeEffect | null)?.target)
        .filter((t): t is Element => t instanceof Element && !(t as Element & { pseudoElement?: string }).pseudoElement),
    );
  } catch {
    return new Set(); // getAnimations unsupported
  }
}

/** How far scrolling moved a sticky element from its place in the flow. */
function stickyOffset(el: HTMLElement): { top: number; left: number } | null {
  const stuck = el.getBoundingClientRect();
  const value = el.style.getPropertyValue('position');
  const priority = el.style.getPropertyPriority('position');
  el.style.setProperty('position', 'static', 'important');
  const flow = el.getBoundingClientRect();
  el.style.removeProperty('position');
  if (value) el.style.setProperty('position', value, priority);
  const top = stuck.top - flow.top;
  const left = stuck.left - flow.left;
  return top || left ? { top, left } : null;
}

/**
 * An SVG drawn as <img> loads no subresource, so media used to be removed —
 * every photo and canvas vanished and the layout collapsed around the holes.
 * Readable pixels (same-origin or CORS images, video frames, canvases) are
 * embedded as data: images at their natural size, as html-to-image embeds
 * <img> sources and modern-screenshot clones canvases, and the element keeps
 * its own CSS, so object-fit, object-position and sprite crops render as on
 * the page. Anything unreadable (cross-origin, iframes) becomes a neutral box
 * of the same size, so the page keeps its shape.
 */
function inlineMedia(liveMedia: Element[], clonedMedia: Element[], isHidden: (el: Element) => boolean): void {
  let count = 0;
  let bytes = 0;
  for (let i = 0; i < clonedMedia.length; i++) {
    const cloned = clonedMedia[i]!;
    const liveEl = liveMedia[i];
    // Layout size, before transforms: the clone keeps the element's transform,
    // so the on-screen (transformed) rect would apply it twice.
    const rect = liveEl?.getBoundingClientRect();
    const layout = liveEl instanceof HTMLElement && liveEl.offsetWidth > 0
      ? { width: liveEl.offsetWidth, height: liveEl.offsetHeight }
      : rect && { width: rect.width, height: rect.height };
    let pixels: Pixels | null = null;
    if (
      liveEl && layout && layout.width > 0 && layout.height > 0 &&
      count < MAX_INLINED_MEDIA && bytes < MAX_INLINED_BYTES && !isHidden(liveEl)
    ) {
      pixels = readPixels(liveEl);
      if (pixels) {
        count++;
        bytes += pixels.url.length;
      }
    }
    replaceMedia(cloned, pixels, layout);
  }
}

interface Pixels {
  url: string;
  /** Intrinsic size, so an element sized by its image keeps that size. */
  width: number;
  height: number;
}

/** Longest side an embedded image keeps; bigger ones are scaled down uniformly. */
const MAX_IMAGE_SIDE = 2048;

function readPixels(el: Element): Pixels | null {
  try {
    let source: CanvasImageSource | null = null;
    let width = 0;
    let height = 0;
    if (el instanceof HTMLCanvasElement) {
      [source, width, height] = [el, el.width, el.height];
    } else if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      [source, width, height] = [el, el.naturalWidth, el.naturalHeight];
    } else if (el instanceof HTMLVideoElement && el.readyState >= 2) {
      [source, width, height] = [el, el.videoWidth, el.videoHeight];
    }
    if (!source || width <= 0 || height <= 0) return null;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    // WebP keeps transparency (JPEG turned every transparent sprite black);
    // engines without a WebP encoder return PNG. Throws for cross-origin
    // pixels without CORS: that image stays a box.
    const url = canvas.toDataURL('image/webp', 0.85);
    return url === 'data:,' ? null : { url, width, height };
  } catch {
    return null;
  }
}

function matchesOrInside(el: Element, selector: string): boolean {
  try {
    return el.closest(selector) !== null;
  } catch {
    return false;
  }
}

/** Source attributes the replacement must not carry: they point at unloadable URLs. */
const SOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'sizes', 'poster', 'data', 'loading', 'decoding']);

function replaceMedia(cloned: Element, pixels: Pixels | null, layout: { width: number; height: number } | undefined): void {
  const box = cloned.ownerDocument.createElement(pixels ? 'img' : 'div');
  // Every other attribute stays, so redaction selectors ([data-private],
  // [data-mushi-mask], host classes) still match the replacement.
  for (const name of cloned.getAttributeNames()) {
    if (!SOURCE_ATTRIBUTES.has(name)) box.setAttribute(name, cloned.getAttribute(name) ?? '');
  }
  // The element's own box; object-fit and object-position from its CSS place
  // the image inside it, exactly as on the page.
  const size = layout ? `width:${layout.width}px;height:${layout.height}px;` : '';
  if (pixels) {
    box.setAttribute('src', pixels.url);
    box.setAttribute('alt', '');
    if (!box.hasAttribute('width')) box.setAttribute('width', String(pixels.width));
    if (!box.hasAttribute('height')) box.setAttribute('height', String(pixels.height));
    box.setAttribute('style', `${box.getAttribute('style') ?? ''};${size}`);
  } else {
    box.setAttribute(
      'style',
      `${box.getAttribute('style') ?? ''};${size}background:#d4d4d4!important;display:${cloned.tagName === 'IMG' || cloned.tagName === 'CANVAS' ? 'inline-block' : 'block'};`,
    );
  }
  // A <picture> keeps its <source> children around the <img>; they would
  // point the browser at an unloadable URL, so the box replaces the picture.
  const parent = cloned.parentElement;
  const target = parent && parent.tagName === 'PICTURE' ? parent : cloned;
  target.replaceWith(box);
}

/**
 * XMLSerializer copies what HTML tolerates but XML rejects, and one such node
 * makes the browser refuse the whole SVG (reported as 'error'):
 * - comments containing "--" (seen live 2026-11-20 on a site's
 *   "font preloads — …" comment); comments draw nothing, so all go, as in
 *   modern-screenshot's cloneChildNodes;
 * - attribute names that are not XML names (`@click`, `:href`, `[disabled]`).
 */
function makeXmlSafe(root: Element): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n);
  for (const c of comments) c.parentNode?.removeChild(c);

  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const name of el.getAttributeNames()) {
      if (!XML_ATTRIBUTE_NAME.test(name)) el.removeAttribute(name);
    }
  }
}

function safeQueryAll(root: Element, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function redactElement(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = '';
    el.setAttribute('value', '');
  }
  el.textContent = '';
  el.setAttribute(
    'style',
    `${el.getAttribute('style') ?? ''};background:#000!important;color:#000!important;text-shadow:none!important;border-color:#000!important;`,
  );
  el.setAttribute('data-mushi-redacted', 'true');
  // Remove child nodes so no text nodes leak through the SVG serialiser
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Remove what an SVG-in-<img> cannot load: external sheets, scripts, cross-origin CSS url()s. */
function stripTaintSources(root: Element): void {
  const pageOrigin = typeof location !== 'undefined' ? location.origin : '';

  // Remove ALL external stylesheets. An SVG rendered through <img> runs in
  // secure static mode and cannot fetch any subresource — even same-origin
  // <link> sheets never load there. Their rules are re-injected as inline
  // <style> text by inlineDocumentStyles() instead.
  for (const link of root.querySelectorAll('link[rel="stylesheet"], link[as="style"]')) {
    link.remove();
  }

  // Strip cross-origin url() references from <style> content.
  for (const styleEl of root.querySelectorAll('style')) {
    const cleaned = stripCssUrlRefs(styleEl.textContent ?? '', pageOrigin);
    if (cleaned !== styleEl.textContent) styleEl.textContent = cleaned;
  }

  // Strip cross-origin url() references from inline style attributes.
  for (const el of root.querySelectorAll('[style]')) {
    const s = el.getAttribute('style');
    if (!s) continue;
    const cleaned = stripCssUrlRefs(s, pageOrigin);
    if (cleaned !== s) el.setAttribute('style', cleaned);
  }

  for (const script of root.querySelectorAll('script, noscript, template')) {
    script.remove();
  }
}

/**
 * Replace cross-origin url() references in a CSS string with `none` so the
 * browser never fetches an external resource that would taint the canvas.
 */
function stripCssUrlRefs(css: string, pageOrigin: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_match, _q, href) => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return _match;
    if (isCrossOriginUrl(trimmed, pageOrigin)) return 'none';
    return _match;
  });
}

/**
 * Re-inject the page's stylesheet rules as one inline <style> block. The live
 * page has them in <link> sheets (and constructable adoptedStyleSheets), but
 * the SVG-in-<img> capture path loads zero subresources, so without this the
 * capture renders unstyled. Same-origin (and CORS-enabled) sheets expose
 * cssRules via CSSOM with no network fetch; unreadable ones are skipped.
 */
/**
 * Each linked sheet's text replaces its own <link>, keeping document order:
 * cascade layers are ordered by first appearance, and appending every sheet
 * after the inline <style> elements reordered `@layer base, components`, so
 * base resets beat component styles (headings lost their size). Constructed
 * sheets come last, as they cascade on the page. Cross-origin url()s are
 * stripped afterwards with the rest (stripTaintSources).
 */
async function inlineDocumentStyles(clone: Element, linkSlots: Map<Node, Element>): Promise<void> {
  const sheets: CSSStyleSheet[] = [
    ...Array.from(document.styleSheets),
    ...(document.adoptedStyleSheets ?? []),
  ];
  const texts = await Promise.all(
    sheets.map(async (sheet) => {
      const owner = sheet.ownerNode;
      // Inline <style> elements are already present in the clone.
      if (sheet.disabled || (owner instanceof Element && owner.tagName === 'STYLE')) return '';
      return withMedia((await sheetSource(sheet)) ?? serializeSheet(sheet), sheet);
    }),
  );
  const head = clone.querySelector('head') ?? clone;
  sheets.forEach((sheet, i) => {
    if (!texts[i]) return;
    const styleEl = document.createElement('style');
    styleEl.textContent = texts[i]!;
    const slot = sheet.ownerNode ? linkSlots.get(sheet.ownerNode) : undefined;
    // A <link> inside a pinned (emptied) subtree is gone; its rules still
    // style the rest of the page.
    if (slot && clone.contains(slot)) slot.replaceWith(styleEl);
    else head.appendChild(styleEl);
  });
}

const SHEET_FETCH_TIMEOUT_MS = 2500;

/**
 * A linked sheet's own text. CSSOM serialisation (cssText) is lossy: Chrome
 * writes `font: 700 var(--size)/1 var(--face)` back as empty longhands, so
 * every such rule lost its font size, line height and family, and the
 * capture's layout drifted hundreds of pixels from the page. The text comes
 * from the HTTP cache the page just filled; when it can't be read (CSP
 * connect-src, no CORS, offline) the caller falls back to the CSSOM.
 */
async function sheetSource(sheet: CSSStyleSheet, depth = 0): Promise<string | null> {
  const href = sheet.href;
  if (!href || depth > 3 || typeof fetch !== 'function') return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => abort?.abort(), SHEET_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(href, { cache: 'force-cache', signal: abort?.signal });
    if (!res.ok) return null;
    // @import never loads inside the SVG: inline what each one imported.
    let imported = '';
    for (const rule of readableRules(sheet)) {
      if (!(rule instanceof CSSImportRule) || !rule.styleSheet) continue;
      const text = (await sheetSource(rule.styleSheet, depth + 1)) ?? serializeSheet(rule.styleSheet);
      imported += wrapImport(text, rule);
    }
    const own = absolutizeCssUrls((await res.text()).replace(/@import\s[^;]*;/gi, ''), href);
    return `${imported}\n${own}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readableRules(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return Array.from(sheet.cssRules);
  } catch {
    return [];
  }
}

function wrapImport(text: string, rule: CSSImportRule): string {
  const layer = (rule as CSSImportRule & { layerName?: string | null }).layerName;
  let out = layer == null ? text : `@layer ${layer}{${text}}`;
  const media = rule.media?.mediaText;
  if (media && media !== 'all') out = `@media ${media}{${out}}`;
  return `${out}\n`;
}

/** A <link media="print"> sheet must not style the capture as if it were screen. */
function withMedia(text: string, sheet: CSSStyleSheet): string {
  const media = sheet.media?.mediaText;
  return text && media && media !== 'all' ? `@media ${media}{${text}}` : text;
}

/** Relative url()s resolve against the sheet, not the page, once the text moves inline. */
function absolutizeCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (match, quote: string, ref: string) => {
    const trimmed = ref.trim();
    if (!trimmed || /^(data:|#|[a-z][a-z\d+.-]*:)/i.test(trimmed)) return match;
    try {
      return `url(${quote}${new URL(trimmed, base).href}${quote})`;
    } catch {
      return match;
    }
  });
}

/**
 * CSS-in-JS libraries (styled-components, Emotion) add rules with insertRule
 * and leave their <style> element empty, so the clone's copy styled nothing.
 * Pairs by document order, right after cloning.
 */
function fillScriptedStyleElements(live: Element, clone: Element): void {
  const liveStyles = live.querySelectorAll('style');
  const cloneStyles = clone.querySelectorAll('style');
  if (liveStyles.length !== cloneStyles.length) return;
  liveStyles.forEach((el, i) => {
    if ((el.textContent ?? '').trim() || !el.sheet) return;
    const text = serializeSheet(el.sheet);
    if (text) cloneStyles[i]!.textContent = text;
  });
}

/**
 * CSS animations never run inside an SVG drawn as an <img>, so anything with
 * an entrance animation (fade-in keyframes starting at opacity 0) stays at its
 * first keyframe and the whole capture comes out transparent. Freeze motion
 * last, after every page style, so the capture shows the settled page the
 * reporter actually sees.
 */
const FREEZE_MOTION_CSS = '*,*::before,*::after{animation:none!important;transition:none!important}';

/**
 * A real page paints its background across the whole viewport (the root
 * background propagates to the canvas). Inside the SVG it stops where the
 * content ends, and the transparent rest turns black once the capture is
 * compressed to JPEG — short pages came out half black. Give the clone's root
 * the page's effective background and the full height.
 */
function fillViewport(clone: Element): void {
  const clear = (c: string) => !c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
  let bg = getComputedStyle(document.documentElement).backgroundColor;
  if (clear(bg) && document.body) bg = getComputedStyle(document.body).backgroundColor;
  const root = clone as HTMLElement;
  root.style.setProperty('background-color', clear(bg) ? 'Canvas' : bg);
  root.style.setProperty('min-height', `${window.innerHeight}px`);
}

function freezeMotion(clone: Element): void {
  const styleEl = document.createElement('style');
  styleEl.textContent = FREEZE_MOTION_CSS;
  (clone.querySelector('head') ?? clone).appendChild(styleEl);
}

function serializeSheet(sheet: CSSStyleSheet): string {
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules; // throws for cross-origin sheets without CORS
  } catch {
    return '';
  }
  let text = '';
  for (const rule of Array.from(rules)) {
    // Expand @import inline — the imported sheet will never be fetched.
    if (rule instanceof CSSImportRule) {
      if (rule.styleSheet) text += serializeSheet(rule.styleSheet);
      continue;
    }
    text += `${rule.cssText}\n`;
  }
  return text;
}

/**
 * WebKit sometimes fires `load` for a foreignObject SVG but rasterises nothing.
 * Sample the canvas on a coarse grid; a fully transparent bitmap means the
 * draw silently produced nothing.
 */
function isCanvasBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    // Probe a coarse grid of single pixels instead of copying the whole
    // bitmap — a full-viewport getImageData allocates megabytes on the
    // report-submit path just to answer "did anything draw?".
    const stepX = Math.max(1, Math.floor(width / 8));
    const stepY = Math.max(1, Math.floor(height / 8));
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        if (ctx.getImageData(x, y, 1, 1).data[3] !== 0) return false;
      }
    }
    return true;
  } catch {
    // Tainted canvas — let toDataURL raise the taint path instead.
    return false;
  }
}

function isCrossOriginUrl(raw: string, pageOrigin: string): boolean {
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return false;
  try {
    const resolved = new URL(raw, typeof location !== 'undefined' ? location.href : 'http://localhost/');
    return Boolean(pageOrigin) && resolved.origin !== pageOrigin;
  } catch {
    return true;
  }
}

function maskElement(el: HTMLElement): void {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = '';
    el.setAttribute('value', '');
    el.setAttribute('placeholder', '••••');
  }
  el.textContent = el.children.length === 0 ? '••••' : el.textContent;
  el.setAttribute(
    'style',
    `${el.getAttribute('style') ?? ''};background:#8f8f8f!important;color:transparent!important;text-shadow:none!important;`,
  );
  el.setAttribute('data-mushi-masked', 'true');
}
