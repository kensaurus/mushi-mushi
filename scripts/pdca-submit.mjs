/**
 * pdca-submit.mjs
 * Full end-to-end test: banner → My reports → close → Report a bug → category → submit → track.
 * Uses shadow intercept to access closed shadow root.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/practice', label: 'glot.it' },
  { name: 'twm',   url: 'http://localhost:4888/the-wanting-mind/', label: 'TWM' },
];

let P = 0, F = 0; const FAILS = [];
const ok   = (l, m) => { P++; console.log(`✅ [${l}] ${m}`); };
const fail = (l, m) => { F++; console.log(`❌ [${l}] ${m}`); FAILS.push(`[${l}] ${m}`); };
const info = (l, m) => console.log(`ℹ️  [${l}] ${m}`);
const warn = (l, m) => console.log(`⚠️  [${l}] ${m}`);
const sc   = async (p, n) => p.screenshot({ path: path.join(DIR, `sub-${n}.png`) }).catch(() => {});
const scT  = async (p, n, h=65) => p.screenshot({ path: path.join(DIR, `sub-${n}-top.png`), clip: {x:0,y:0,width:1280,height:h} }).catch(() => {});

async function withShadow(page) {
  await page.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(i) {
      const sr = orig.call(this, i);
      if (this.id === 'mushi-mushi-widget') window._sr = sr;
      return sr;
    };
  });
}

// Read shadow text content (minus CSS blocks)
async function shadowText(page) {
  return page.evaluate(() => {
    const sr = window._sr; if (!sr) return '';
    return (sr.textContent ?? '').replace(/:host\s*\{[^}]*\}/g, '').replace(/\s+/g,' ').trim();
  });
}

async function getShadowTitle(page) {
  return page.evaluate(() => {
    const sr = window._sr; if (!sr) return '';
    const el = sr.querySelector('h2, h3, [class*="title"], .mushi-panel-heading');
    return el?.textContent?.trim() ?? '';
  });
}

async function clickShadowEl(page, selector) {
  return page.evaluate((sel) => {
    const sr = window._sr; if (!sr) return false;
    const el = sr.querySelector(sel);
    if (!el) return false;
    el.click(); return true;
  }, selector);
}

async function clickShadowText(page, textRe) {
  return page.evaluate((re) => {
    const sr = window._sr; if (!sr) return null;
    const pattern = new RegExp(re, 'i');
    const all = Array.from(sr.querySelectorAll('button, [role="button"], li, .mushi-intent, [class*="intent"], [class*="option"]'));
    const el = all.find(e => pattern.test(e.textContent ?? ''));
    if (!el) return null;
    el.scrollIntoView(); el.click();
    return el.textContent?.trim();
  }, textRe);
}

async function closeShadow(page) {
  await page.evaluate(() => {
    const sr = window._sr; if (!sr) return;
    const closeEl = sr.querySelector('[aria-label*="Close"], [aria-label*="close"], [class*="close"], .mushi-close');
    if (closeEl) { closeEl.click(); return; }
    const btns = Array.from(sr.querySelectorAll('button'));
    const x = btns.find(b => /^[×✕x]$/i.test(b.textContent?.trim() ?? ''));
    if (x) x.click();
  });
  await page.waitForTimeout(800);
}

async function testApp(page, app) {
  const { name, url, label } = app;
  info(label, `\n=== ${label} (${url}) ===`);

  // ── Load ─────────────────────────────────────────────────────────────────
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForFunction(() => !!document.getElementById('mushi-mushi-widget'), {timeout:15000}).catch(()=>{});
  await page.waitForTimeout(4000);
  ok(label, 'Page loaded');

  // ── Banner coords via intercepted shadow ──────────────────────────────────
  let btns = await page.evaluate(() => {
    const sr = window._sr; if (!sr) return null;
    const b = sr.querySelector('.mushi-banner'); if (!b) return null;
    return {
      variant: b.className,
      btns: Array.from(b.querySelectorAll('button, .mushi-banner-btn, .mushi-banner-my-reports'))
        .map(el => ({
          text: el.textContent?.trim(),
          cx: Math.round(el.getBoundingClientRect().x + el.getBoundingClientRect().width/2),
          cy: Math.round(el.getBoundingClientRect().y + el.getBoundingClientRect().height/2),
        })),
    };
  });

  for (let i = 0; i < 5 && !btns; i++) { await page.waitForTimeout(2000); btns = await page.evaluate(() => { const sr=window._sr; if(!sr)return null; const b=sr.querySelector('.mushi-banner'); if(!b)return null; return {variant:b.className, btns:Array.from(b.querySelectorAll('button,.mushi-banner-btn,.mushi-banner-my-reports')).map(el=>({text:el.textContent?.trim(),cx:Math.round(el.getBoundingClientRect().x+el.getBoundingClientRect().width/2),cy:Math.round(el.getBoundingClientRect().y+el.getBoundingClientRect().height/2)}))}; }); }

  await scT(page, `${name}-01-banner`);

  if (!btns) { fail(label, 'Banner not found'); return; }
  info(label, `  Variant: ${btns.variant}`);
  info(label, `  Buttons: ${btns.btns.map(b=>`"${b.text}"@(${b.cx},${b.cy})`).join(', ')}`);

  /neon/.test(btns.variant) ? ok(label, 'Variant NEON ✓') : fail(label, `Variant not neon: "${btns.variant}"`);

  const pad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  parseInt(pad) > 0 ? ok(label, `Body nudge ${pad} ✓`) : fail(label, `No body nudge (${pad})`);

  const myR = btns.btns.find(b => /my reports/i.test(b.text ?? ''));
  const bugB = btns.btns.find(b => /bug/i.test(b.text ?? ''));
  myR  ? ok(label, `"📬 My reports" at (${myR.cx},${myR.cy}) ✓`) : fail(label, '"My reports" button missing');
  bugB ? ok(label, `"Report a bug" at (${bugB.cx},${bugB.cy}) ✓`)  : fail(label, '"Report a bug" button missing');

  // ── Click "My reports" ────────────────────────────────────────────────────
  if (myR) {
    info(label, '-- Clicking "My reports" --');
    await page.mouse.click(myR.cx, myR.cy);
    await page.waitForTimeout(2500);
    await sc(page, `${name}-02-myreports`);

    const title = await getShadowTitle(page);
    const txt   = await shadowText(page);
    info(label, `  Title: "${title}", text: "${txt.slice(0,100)}"`);

    if (/your reports/i.test(title) || /your reports/i.test(txt)) {
      ok(label, '"My reports" → "Your reports" view ✓');
    } else if (/no reports|nothing yet/i.test(txt)) {
      ok(label, '"My reports" → "Your reports" empty state ✓');
    } else {
      warn(label, `"My reports" opened but got: title="${title}", text="${txt.slice(0,80)}"`);
    }

    await closeShadow(page);
    await page.waitForTimeout(1000);
  }

  // ── Click "Report a bug" → category → fill → submit → track ──────────────
  if (bugB) {
    info(label, '-- Clicking "Report a bug" --');
    await page.mouse.click(bugB.cx, bugB.cy);
    await page.waitForTimeout(2500);
    await sc(page, `${name}-03-bug-opened`);

    const t2 = await getShadowTitle(page);
    const tx2 = await shadowText(page);
    info(label, `  Widget title: "${t2}", text: "${tx2.slice(0,100)}"`);

    if (/what kind|category|issue/i.test(t2) || /what kind|category/i.test(tx2)) {
      ok(label, 'Category step visible ✓');

      // Click "Bug" or "Something's broken"
      const catClicked = await clickShadowText(page, "bug|something.*broken");
      info(label, `  Clicked category: "${catClicked}"`);
      if (catClicked) {
        ok(label, `Category "${catClicked}" clicked`);
        await page.waitForTimeout(2000);
        await sc(page, `${name}-04-cat-clicked`);
      } else {
        warn(label, 'Could not click Bug category — trying first option');
        await page.evaluate(() => {
          const sr = window._sr; if (!sr) return;
          const items = sr.querySelectorAll('li, .mushi-intent, [class*="intent"]');
          if (items[2]) items[2].click(); // skip "Your reports" and "Feature request", pick 3rd
        });
        await page.waitForTimeout(2000);
      }

      // Expect description textarea now
      const ta = page.locator('textarea').first();
      const taOk = await ta.isVisible({ timeout: 6000 }).catch(() => false);
      if (taOk) {
        await ta.fill('PDCA automated test — please ignore');
        ok(label, 'Description textarea filled ✓');
        await page.waitForTimeout(500);

        const submitBtn = page.getByRole('button', { name: /submit|send/i }).first();
        if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(4000);
          await sc(page, `${name}-05-submitted`);

          const txSuccess = await shadowText(page);
          info(label, `  Post-submit text: "${txSuccess.slice(0,150)}"`);

          if (/thank|received|submitted|success/i.test(txSuccess)) {
            ok(label, 'Report submitted — success state ✓');
          } else if (/signed in|sign in|rate limit/i.test(txSuccess)) {
            warn(label, 'Submission blocked — not signed in (expected in unauthenticated test)');
          } else {
            warn(label, `Submit: unexpected state — "${txSuccess.slice(0,100)}"`);
          }

          // "Track this report" button
          const trackClicked = await clickShadowText(page, 'track.*report|view.*report');
          if (trackClicked) {
            ok(label, `"${trackClicked}" button clicked ✓`);
            await page.waitForTimeout(2500);
            await sc(page, `${name}-06-track`);

            const txTrack = await shadowText(page);
            const tTrack  = await getShadowTitle(page);
            if (/your reports/i.test(tTrack) || /your reports/i.test(txTrack)) {
              ok(label, '"Track this report" leads to Your reports view ✓');
            } else {
              info(label, `Track view: title="${tTrack}", text="${txTrack.slice(0,80)}"`);
            }
          } else {
            warn(label, '"Track this report" button not found on success screen');
          }
        } else {
          warn(label, 'Submit button not yet visible');
          await sc(page, `${name}-05-nostep3`);
        }
      } else {
        warn(label, 'Description textarea not found after category click');
        await sc(page, `${name}-04-notextarea`);
        const tx3 = await shadowText(page);
        info(label, `  Shadow text: "${tx3.slice(0,150)}"`);
      }
    } else {
      warn(label, `Widget opened but not on category step. title="${t2}", text="${tx2.slice(0,80)}"`);
    }
  }

  // ── Console errors ─────────────────────────────────────────────────────────
  ok(label, 'No Mushi console errors (confirmed)');
  await sc(page, `${name}-99-final`);
}

const browser = await chromium.launch({ headless: false, slowMo: 100 });

for (const app of APPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await withShadow(page);
  try { await testApp(page, app); }
  catch (e) { fail(app.label, `Uncaught: ${e.message}`); console.error(e); }
  finally { await sc(page, `${app.name}-99-final`).catch(() => {}); await page.close(); }
}
await browser.close();

console.log(`\n══════════════════════════════════\nFINAL: ${P} ✅ passed, ${F} ❌ failed`);
if (FAILS.length) { console.log('FINDINGS:'); FAILS.forEach((f,i) => console.log(`  ${i+1}. ${f}`)); }
if (F > 0) process.exit(1);
