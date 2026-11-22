/**
 * Browser-side overlay for the docs walkthrough recorder (scripts/record-docs-walkthroughs.mjs).
 *
 * Injected with page.addInitScript, so it is present on every page load. It
 * draws, on top of the real page: a pointer that glides to what to press, a
 * ripple on each click, a ring around the thing being explained, a caption
 * bar ("Step 2 of 6: ..."), a title card, and a zoom on the part that matters.
 *
 * The overlay lives under <html>, outside <body>, so zooming <body> does not
 * scale the pointer or the captions. It never takes pointer events.
 *
 * `__WT_PRIVACY__` (set by the recorder before this file runs) lists
 * [from, to] text swaps for names that must not appear in a public video.
 */
;(() => {
  if (window.__wt) return
  const Z = 2147483647
  const ACCENT = '#f5b83d'
  const swaps = Array.isArray(window.__WT_PRIVACY__) ? window.__WT_PRIVACY__ : []

  const css = `
  #wt-root { position: fixed; inset: 0; pointer-events: none; z-index: ${Z}; font-family: Inter, 'Segoe UI', system-ui, -apple-system, sans-serif; }
  #wt-cursor { position: fixed; left: 0; top: 0; width: 30px; height: 30px; transform: translate(-3px, -2px); transition: transform 120ms ease; filter: drop-shadow(0 2px 4px rgba(0,0,0,.45)); will-change: left, top; }
  #wt-cursor.down { transform: translate(-3px, -2px) scale(.82); }
  .wt-ripple { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid ${ACCENT}; animation: wt-ripple 650ms ease-out forwards; }
  @keyframes wt-ripple { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(3.6); } }
  #wt-ring { position: fixed; border-radius: 12px; border: 3px solid ${ACCENT}; box-shadow: 0 0 0 6px rgba(245,184,61,.22), 0 0 32px rgba(245,184,61,.35); opacity: 0; transition: left 520ms cubic-bezier(.2,.8,.2,1), top 520ms cubic-bezier(.2,.8,.2,1), width 520ms cubic-bezier(.2,.8,.2,1), height 520ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease; animation: wt-pulse 1.6s ease-in-out infinite; }
  @keyframes wt-pulse { 0%,100% { box-shadow: 0 0 0 5px rgba(245,184,61,.20), 0 0 26px rgba(245,184,61,.30); } 50% { box-shadow: 0 0 0 10px rgba(245,184,61,.10), 0 0 40px rgba(245,184,61,.45); } }
  #wt-caption { position: fixed; left: 50%; bottom: 26px; transform: translate(-50%, 16px); max-width: min(980px, calc(100vw - 80px)); display: flex; gap: 16px; align-items: flex-start; padding: 16px 22px; border-radius: 16px; background: rgba(14,14,18,.92); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 18px 50px rgba(0,0,0,.45); color: #fff; opacity: 0; transition: opacity 320ms ease, transform 420ms cubic-bezier(.2,.8,.2,1); }
  #wt-caption.on { opacity: 1; transform: translate(-50%, 0); }
  #wt-caption.top { bottom: auto; top: 22px; transform: translate(-50%, -16px); }
  #wt-caption.top.on { transform: translate(-50%, 0); }
  #wt-caption .n { flex: none; min-width: 54px; padding: 4px 10px; border-radius: 999px; background: ${ACCENT}; color: #1a1406; font-weight: 800; font-size: 16px; text-align: center; margin-top: 2px; }
  #wt-caption .t { font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: -.01em; }
  #wt-caption .d { margin-top: 4px; font-size: 16px; line-height: 1.45; color: #cfd0d8; }
  #wt-card { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(10,10,14,.78); backdrop-filter: blur(6px); opacity: 0; transition: opacity 420ms ease; }
  #wt-card.on { opacity: 1; }
  #wt-card .box { text-align: center; color: #fff; max-width: 900px; padding: 0 40px; }
  #wt-card .k { display: inline-block; font-size: 15px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: ${ACCENT}; margin-bottom: 14px; }
  #wt-card .h { font-size: 46px; font-weight: 800; letter-spacing: -.02em; line-height: 1.12; }
  #wt-card .s { margin-top: 16px; font-size: 22px; color: #d6d7de; line-height: 1.45; }
  `

  let root, cursor, ring, caption, card
  const pos = { x: -60, y: -60 }

  function mount() {
    if (root && root.isConnected) return
    const style = document.createElement('style')
    style.id = 'wt-style'
    style.textContent = css
    root = document.createElement('div')
    root.id = 'wt-root'
    root.innerHTML = `
      <div id="wt-card"><div class="box"><div class="k"></div><div class="h"></div><div class="s"></div></div></div>
      <div id="wt-ring"></div>
      <div id="wt-caption"><div class="n"></div><div><div class="t"></div><div class="d"></div></div></div>
      <svg id="wt-cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.5l15 9.2-6.6 1.5 3.9 7.3-3 1.6-3.9-7.4L4.6 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>`
    document.documentElement.appendChild(style)
    document.documentElement.appendChild(root)
    cursor = root.querySelector('#wt-cursor')
    ring = root.querySelector('#wt-ring')
    caption = root.querySelector('#wt-caption')
    card = root.querySelector('#wt-card')
    place()
  }

  function place() {
    cursor.style.left = `${pos.x}px`
    cursor.style.top = `${pos.y}px`
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

  function moveTo(x, y, ms = 700) {
    mount()
    const from = { ...pos }
    // A slight arc reads as a hand, a straight line reads as a robot.
    const bend = Math.min(80, Math.hypot(x - from.x, y - from.y) * 0.12)
    return new Promise((resolve) => {
      const t0 = performance.now()
      const tick = (now) => {
        const t = Math.min(1, (now - t0) / ms)
        const e = ease(t)
        pos.x = from.x + (x - from.x) * e
        pos.y = from.y + (y - from.y) * e - Math.sin(Math.PI * e) * bend
        place()
        if (t < 1) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }

  function jump(x, y) {
    mount()
    pos.x = x
    pos.y = y
    place()
  }

  function click() {
    mount()
    cursor.classList.add('down')
    const r = document.createElement('div')
    r.className = 'wt-ripple'
    r.style.left = `${pos.x}px`
    r.style.top = `${pos.y}px`
    root.appendChild(r)
    setTimeout(() => cursor.classList.remove('down'), 160)
    setTimeout(() => r.remove(), 700)
  }

  function showRing(rect) {
    mount()
    if (!rect) {
      ring.style.opacity = '0'
      return
    }
    const pad = 6
    ring.style.left = `${rect.x - pad}px`
    ring.style.top = `${rect.y - pad}px`
    ring.style.width = `${rect.width + pad * 2}px`
    ring.style.height = `${rect.height + pad * 2}px`
    ring.style.opacity = '1'
  }

  function showCaption(c) {
    mount()
    if (!c) {
      caption.classList.remove('on')
      return
    }
    caption.querySelector('.n').textContent = `${c.step} / ${c.total}`
    caption.querySelector('.t').textContent = c.title
    caption.querySelector('.d').textContent = c.detail || ''
    caption.querySelector('.d').style.display = c.detail ? '' : 'none'
    caption.classList.remove('on')
    caption.classList.toggle('top', c.at === 'top')
    void caption.offsetWidth
    caption.classList.add('on')
  }

  function showCard(c) {
    mount()
    if (!c) {
      card.classList.remove('on')
      return
    }
    card.querySelector('.k').textContent = c.kicker || 'Mushi Mushi'
    card.querySelector('.h').textContent = c.title
    card.querySelector('.s').textContent = c.subtitle || ''
    card.classList.add('on')
  }

  /** Zoom <body> so the viewport point (cx, cy) sits in the middle, clamped to the page edges. */
  function zoom(scale, cx, cy, ms = 750) {
    const b = document.body
    const W = window.innerWidth
    const H = window.innerHeight
    if (!scale || scale === 1) {
      b.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`
      b.style.transform = ''
      return
    }
    const tx = Math.min(0, Math.max(W - scale * W, W / 2 - scale * cx))
    const ty = Math.min(0, Math.max(H - scale * H, H / 2 - scale * cy))
    b.style.transformOrigin = '0 0'
    b.style.transition = `transform ${ms}ms cubic-bezier(.2,.8,.2,1)`
    b.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
  }

  function swapText(node) {
    if (!swaps.length) return
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      let v = n.nodeValue
      if (!v) continue
      let changed = false
      for (const [from, to] of swaps) {
        if (v.includes(from)) {
          v = v.split(from).join(to)
          changed = true
        }
      }
      if (changed) n.nodeValue = v
    }
  }

  if (swaps.length) {
    const start = () => {
      swapText(document.body)
      new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') swapText(m.target.parentNode || m.target)
          for (const n of m.addedNodes) swapText(n)
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    }
    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start)
  }

  /** The text of every visible text node that sits at least partly in the viewport. */
  function visibleText() {
    const W = window.innerWidth
    const H = window.innerHeight
    const out = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const v = n.nodeValue && n.nodeValue.trim()
      const el = n.parentElement
      if (!v || !el || (root && root.contains(el))) continue
      // Collapsed <details> content and other hidden-but-laid-out text never reaches a frame.
      const closed = el.closest('details:not([open])')
      if (closed && !el.closest('summary')) continue
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      out.push(v.replace(/\s+/g, ' '))
    }
    return out.join('\n')
  }

  window.__wt = { mount, moveTo, jump, click, ring: showRing, caption: showCaption, card: showCard, zoom, pos, visibleText }
  if (document.readyState !== 'loading') mount()
  else document.addEventListener('DOMContentLoaded', mount)
})()
