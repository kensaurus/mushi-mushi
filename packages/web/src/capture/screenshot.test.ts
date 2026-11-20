import { describe, it, expect, vi, afterEach } from 'vitest';
import { createScreenshotCapture } from './screenshot';

/**
 * The widget turns these reasons into actionable copy ("blocked by another
 * site", "timed out"…), so each failure path must report its own reason —
 * a timeout used to arrive as a generic 'error'.
 */
describe('createScreenshotCapture failure reasons', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reports 'unsupported' when the browser has no 2D canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const onFailed = vi.fn();
    const events: unknown[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).detail);
    document.addEventListener('mushi:screenshot_failed', listener);

    await expect(createScreenshotCapture({ onFailed }).take()).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('unsupported');
    expect(events).toEqual([{ reason: 'unsupported' }]);
    document.removeEventListener('mushi:screenshot_failed', listener);
  });

  it("reports 'timeout' when the page image never loads", async () => {
    vi.useFakeTimers();
    const ctx = { scale: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    // jsdom never fires load/error for the SVG image — exactly the WebKit limbo case.
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('timeout');
  });

  /** Capture the <img> the capturer creates instead of letting jsdom load it. */
  function interceptImage(): { img: () => HTMLImageElement; src: () => string } {
    let img: HTMLImageElement | null = null;
    let src = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
      img = this;
      src = v;
    });
    return { img: () => img!, src: () => src };
  }

  it('loads the page as a data: URL — Chrome taints a foreignObject SVG from a blob: URL', async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();

    void createScreenshotCapture().take();
    await vi.advanceTimersByTimeAsync(0);
    expect(spy.src()).toMatch(/^data:image\/svg\+xml;charset=utf-8,(%0A|%20)*%3Csvg/i);
    expect(spy.src()).not.toMatch(/^blob:/);
  });

  it('freezes animations after every page style, so entrance animations cannot blank the capture', async () => {
    // Live QA (console, Chrome): fade-in keyframes start at opacity 0 and never
    // run inside an SVG <img>, so the whole page captured transparent.
    const style = document.createElement('style');
    style.textContent = '@keyframes fade-in{from{opacity:0}} .animate-in{animation:fade-in .3s}';
    document.head.append(style);
    const card = document.createElement('div');
    card.className = 'animate-in';
    card.textContent = 'Settled content';
    document.body.append(card);
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();

    void createScreenshotCapture().take();
    await vi.advanceTimersByTimeAsync(0);
    const svg = decodeURIComponent(spy.src().replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    const freeze = '*,*::before,*::after{animation:none!important;transition:none!important}';
    expect(svg).toContain('Settled content');
    expect(svg.lastIndexOf(freeze)).toBeGreaterThan(svg.lastIndexOf('@keyframes fade-in'));
    // Nothing that styles the page comes after the freeze rule.
    expect(svg.slice(svg.lastIndexOf(freeze)).indexOf('<style')).toBe(-1);
    style.remove();
    card.remove();
  });

  it('paints the page background across the whole capture, so short pages are not half black', async () => {
    document.body.style.backgroundColor = 'rgb(246, 247, 249)';
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();

    void createScreenshotCapture().take();
    await vi.advanceTimersByTimeAsync(0);
    const svg = decodeURIComponent(spy.src().replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    const root = svg.match(/<html[^>]*style="([^"]*)"/)?.[1] ?? '';
    expect(root).toContain('background-color: rgb(246, 247, 249)');
    expect(root).toContain(`min-height: ${window.innerHeight}px`);
    document.body.style.backgroundColor = '';
  });

  it('asks for a readback-friendly canvas (no Canvas2D getImageData warning)', async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await createScreenshotCapture().take();
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });

  it("reports 'csp' when the host's img-src blocks data: images", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(0);
    // Browser order is unspecified: error first, violation event right after.
    spy.img().onerror?.(new Event('error'));
    document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), {
      violatedDirective: 'img-src',
      blockedURI: 'data',
    }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('csp');
  });

  it("an image error without a CSP violation stays 'error'", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    const spy = interceptImage();
    const onFailed = vi.fn();

    const pending = createScreenshotCapture({ onFailed }).take();
    await vi.advanceTimersByTimeAsync(0);
    spy.img().onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(onFailed).toHaveBeenCalledWith('error');
  });
});

const SECRETS_HTML = `
  <input type="password" value="hunter2-secret">
  <input autocomplete="cc-number" value="4111111111111111">
  <input autocomplete="cc-csc" value="737">
  <div data-private><span>SSN 123-45-6789</span></div>
  <p data-mushi-mask>mask-me-token</p>
  <p class="ssn">host-listed-999</p>
  <p>Visible copy</p>`;
const SECRETS = ['hunter2-secret', '4111111111111111', '737', '123-45-6789', 'mask-me-token'];

describe('screenshot redaction before capture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('blacks out passwords, card fields, [data-private] and [data-mushi-mask] even with a custom redact list', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = SECRETS_HTML;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn() } as never);
    let src = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation((v: string) => { src = v; });

    void createScreenshotCapture({ privacy: { redactSelectors: ['.ssn'] } }).take();
    await vi.advanceTimersByTimeAsync(0);
    const svg = decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    for (const secret of [...SECRETS, 'host-listed-999']) expect(svg).not.toContain(secret);
    expect(svg).toContain('Visible copy');
    // The live page is untouched — only the serialized clone is redacted.
    expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe('hunter2-secret');
  });
});

/**
 * Live QA 2026-11-20 (a real site): every capture failed with 'error' because
 * one HTML comment contained "--", which XML forbids, so the browser refused
 * the whole SVG. And media used to be deleted, so photos and canvases were
 * missing and the layout collapsed around them.
 */
describe('capture markup is valid XML and keeps the page whole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const drawImage = vi.fn();

  async function capturedSvg(privacy?: Parameters<typeof createScreenshotCapture>[0]): Promise<string> {
    // The capture chunk is a dynamic import; load it first so one timer tick suffices.
    await import('./screenshot-dom');
    vi.useFakeTimers();
    drawImage.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ scale: vi.fn(), drawImage } as never);
    let src = '';
    vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation((v: string) => { src = v; });
    void createScreenshotCapture(privacy).take();
    await vi.advanceTimersByTimeAsync(0);
    return decodeURIComponent(src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  }

  function sized(el: Element, width: number, height: number): void {
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON: () => ({}) } as DOMRect);
  }

  it('drops comments, non-XML attribute names and control characters, so the SVG parses', async () => {
    document.body.innerHTML = '<!-- font preloads -- critical faces --><button @click="go" :href="x" data-ok="1">Book\u0008 now</button>';
    const svg = await capturedSvg();
    expect(svg).not.toContain('<!--');
    expect(svg).not.toMatch(/\s[@:][a-z]+=/);
    expect(svg).toContain('data-ok="1"');
    expect(svg).toContain('Book now');
    const parsed = new DOMParser().parseFromString(svg.trim(), 'image/svg+xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
  });

  it('copies a canvas in as an image at its natural size, in its own box', async () => {
    document.body.innerHTML = '<canvas id="scene" width="40" height="20"></canvas>';
    const scene = document.getElementById('scene')!;
    sized(scene, 400, 200);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/webp;base64,U0NFTkU=');
    const svg = await capturedSvg();
    expect(svg).toMatch(/<img[^>]*id="scene"[^>]*src="data:image\/webp;base64,U0NFTkU="/);
    expect(svg).toContain('width:400px;height:200px;');
    // Drawn 1:1 from its own pixels (not squeezed into the box), as WebP so
    // transparent sprites keep their alpha instead of turning black in JPEG.
    expect(drawImage).toHaveBeenCalledWith(scene, 0, 0, 40, 20);
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.85);
  });

  it('keeps an unreadable image as a same-size box instead of collapsing the layout', async () => {
    document.body.innerHTML = '<img id="hero" class="cover" src="https://cdn.example.com/hero.jpg">';
    sized(document.getElementById('hero')!, 800, 300);
    const svg = await capturedSvg();
    expect(svg).not.toContain('cdn.example.com');
    expect(svg).toMatch(/<div[^>]*id="hero"[^>]*class="cover"|<div[^>]*class="cover"[^>]*id="hero"/);
    expect(svg).toContain('width:800px;height:300px;');
  });

  it('holds the current frame of running animations instead of resetting them', async () => {
    document.body.innerHTML = '<div id="sprite" class="walker"></div><div id="still"></div>';
    const sprite = document.getElementById('sprite')!;
    // What getComputedStyle reports mid-animation (jsdom reads inline style).
    sprite.style.transform = 'translateX(-64px)';
    sprite.style.opacity = '0.5';
    Object.defineProperty(document, 'getAnimations', {
      configurable: true,
      value: () => [{ effect: { target: sprite } }],
    });
    const svg = await capturedSvg();
    delete (document as { getAnimations?: unknown }).getAnimations;
    const spriteStyle = svg.match(/<div[^>]*id="sprite"[^>]*style="([^"]*)"/)?.[1] ?? svg.match(/<div[^>]*style="([^"]*)"[^>]*id="sprite"/)?.[1] ?? '';
    expect(spriteStyle).toContain('transform:translateX(-64px)!important');
    expect(spriteStyle).toContain('opacity:0.5!important');
    expect(svg).not.toMatch(/id="still"[^>]*style=/);
  });

  it('shows where the user scrolled: the page, an app-shell container, not the fixed header', async () => {
    document.body.innerHTML =
      '<header id="bar" style="position:fixed;top:0">Menu</header>' +
      '<main id="shell" style="overflow:auto;height:600px"><section id="row">Prices</section></main>';
    const shell = document.getElementById('shell')!;
    Object.defineProperty(shell, 'scrollTop', { configurable: true, get: () => 1200 });
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => 300 });
    try {
      const svg = await capturedSvg();
      // The container's content moves up by its scroll offset...
      expect(svg).toMatch(/id="row"[^>]*style="[^"]*transform:translate\(0px, -1200px\)!important/);
      // ...the page by the window's, without a transform (fixed stays on screen)...
      expect(svg).toMatch(/<html[^>]*style="[^"]*position: ?relative ?!important;\s*top: ?-300px ?!important/);
      // ...and the fixed header is not shifted at all.
      expect(svg).not.toMatch(/id="bar"[^>]*translate/);
    } finally {
      delete (window as { scrollY?: number }).scrollY;
    }
  });

  it("inlines a linked sheet's own text, which keeps var() shorthands the CSSOM drops", async () => {
    document.body.innerHTML = '<h2 class="title">Book</h2>';
    const sheet = {
      href: 'https://app.example/assets/app.css',
      ownerNode: document.createElement('link'),
      disabled: false,
      media: { mediaText: '' },
      // What Chrome's cssText gives back for a font shorthand with var().
      cssRules: [{ cssText: '.title { font-style: ; font-size: ; }' }],
    };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([sheet] as unknown as StyleSheetList);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      '@import url(reset.css);.title{font:700 var(--size)/1 var(--face);background:url(img/sky.png)}',
    ));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const svg = await capturedSvg();
      expect(fetchMock).toHaveBeenCalledWith('https://app.example/assets/app.css', expect.objectContaining({ cache: 'force-cache' }));
      expect(svg).toContain('font:700 var(--size)/1 var(--face)');
      expect(svg).not.toContain('font-size: ;');
      // Relative url()s resolve against the sheet, and the @import is gone.
      expect(svg).not.toContain('@import');
      expect(svg).not.toContain('url(img/sky.png)');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts each linked sheet where its <link> was, so cascade layers keep their order', async () => {
    document.head.innerHTML =
      '<link rel="stylesheet" href="https://app.example/index.css">' +
      '<style>@layer overrides { .late { color: red } }</style>';
    document.body.innerHTML = '<h2 class="late">Title</h2>';
    const link = document.head.querySelector('link')!;
    const sheet = { href: 'https://app.example/index.css', ownerNode: link, disabled: false, media: { mediaText: '' }, cssRules: [] };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([sheet] as unknown as StyleSheetList);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('@layer base, components, overrides;')));
    try {
      const svg = await capturedSvg();
      const declared = svg.indexOf('@layer base, components, overrides;');
      expect(declared).toBeGreaterThan(-1);
      expect(declared).toBeLessThan(svg.indexOf('@layer overrides {'));
      expect(svg).not.toContain('<link');
    } finally {
      vi.unstubAllGlobals();
      document.head.innerHTML = '';
    }
  });

  it('embeds visible CSS background images, which the SVG cannot load', async () => {
    document.body.innerHTML = '<span id="sprite" style="background-image:url(/sennin/sheet.png)"></span>';
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const svg = await capturedSvg();
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/sennin/sheet.png'), expect.objectContaining({ cache: 'force-cache' }));
      expect(svg).toMatch(/id="sprite"[^>]*background-image:url\(("|&quot;)?data:image\/png;base64,/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps what the page hides hidden, even where the SVG reads media queries differently', async () => {
    document.body.innerHTML = '<button id="hide" style="opacity:0">×</button><p id="gone" style="display:none">x</p>';
    const svg = await capturedSvg();
    expect(svg).toMatch(/id="hide"[^>]*opacity:0!important/);
    expect(svg).toMatch(/id="gone"[^>]*display:none!important/);
  });

  it('falls back to the CSSOM when the sheet text cannot be fetched', async () => {
    document.body.innerHTML = '<p class="x">Hi</p>';
    const sheet = { href: 'https://app.example/a.css', ownerNode: document.createElement('link'), disabled: false, media: { mediaText: '' }, cssRules: [{ cssText: '.x { color: red; }' }] };
    vi.spyOn(document, 'styleSheets', 'get').mockReturnValue([sheet] as unknown as StyleSheetList);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked by CSP')));
    try {
      expect(await capturedSvg()).toContain('.x { color: red; }');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('copies CSS-in-JS rules added with insertRule into the empty <style> element', async () => {
    document.body.innerHTML = '<p class="sc-abc">Styled</p>';
    const style = document.createElement('style');
    document.head.appendChild(style);
    style.sheet!.insertRule('.sc-abc { color: rgb(1, 2, 3); }');
    try {
      expect(await capturedSvg()).toMatch(/\.sc-abc\s*\{\s*color: rgb\(1, 2, 3\);?\s*\}/);
    } finally {
      style.remove();
    }
  });

  it('pins off-screen sections to their live size and drops their content', async () => {
    document.body.innerHTML =
      '<section id="above"><p>Long story</p><canvas id="art" width="4" height="4"></canvas></section>' +
      '<section id="here"><p>Prices</p></section>';
    const box = (el: Element, top: number, height: number) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x: 0, y: top, top, left: 0, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) } as DOMRect);
      Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => 800 });
      Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => height });
    };
    box(document.getElementById('above')!, -2400, 2000);
    box(document.querySelector('#above p')!, -2400, 100);
    box(document.getElementById('art')!, -2200, 400);
    box(document.getElementById('here')!, 0, 600);
    box(document.querySelector('#here p')!, 0, 40);
    const svg = await capturedSvg();
    expect(svg).toMatch(/<section id="above" style="[^"]*width:800px!important;height:2000px!important/);
    expect(svg).not.toContain('Long story');
    expect(drawImage).not.toHaveBeenCalled(); // the off-screen canvas is never read
    expect(svg).toContain('Prices');
    expect(svg).not.toMatch(/id="here"[^>]*height:600px/);
  });

  it('never reads the pixels of media inside a redacted or masked element', async () => {
    document.body.innerHTML = '<div data-private><canvas id="card" width="10" height="10"></canvas></div><canvas id="open" width="10" height="10"></canvas>';
    sized(document.getElementById('card')!, 100, 60);
    sized(document.getElementById('open')!, 100, 60);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,T1BFTg==');
    const svg = await capturedSvg();
    // Only the open canvas is drawn from; the private one stays a blacked-out box.
    expect(drawImage.mock.calls.map((c) => (c[0] as HTMLCanvasElement).id)).toEqual(['open']);
    expect(svg).not.toMatch(/id="card"[^>]*src=/);
  });
});

describe('tab-share frame grab', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('masks sensitive selectors on the page while the frame is drawn, then stops the share', async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    let maskDuringDraw = '';
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => { maskDuringDraw = document.querySelector('style[data-mushi-capture-mask]')?.textContent ?? ''; },
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,VEFC');
    const { grabMaskedTabFrame } = await import('./display-capture');

    const pending = grabMaskedTabFrame(Promise.resolve(stream), ['input[type="password"]', '[data-private]']);
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBe('data:image/jpeg;base64,VEFC');
    expect(maskDuringDraw).toContain(':is(input[type="password"],[data-private])');
    expect(document.querySelector('style[data-mushi-capture-mask]')).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('refuses a window or screen share (masking only reaches this page) and stops it', async () => {
    const stop = vi.fn();
    const stream = {
      getTracks: () => [{ stop }],
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
    } as unknown as MediaStream;
    const { grabMaskedTabFrame } = await import('./display-capture');
    await expect(grabMaskedTabFrame(Promise.resolve(stream), ['[data-private]'])).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('style[data-mushi-capture-mask]')).toBeNull();
  });

  it('a cancelled share rejects and leaves no mask behind', async () => {
    const { grabMaskedTabFrame } = await import('./display-capture');
    const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    await expect(grabMaskedTabFrame(Promise.reject(denied), ['[data-private]'])).rejects.toBe(denied);
    expect(document.querySelector('style[data-mushi-capture-mask]')).toBeNull();
  });
});
