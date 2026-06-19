/**
 * pdca-full.mjs — Comprehensive headed PDCA test for the Mushi banner + openReporter() changes.
 * Tests both glot.it (Next.js / port 3847) and TWM (Vite / port 4888).
 * Drives a real headed Chromium browser as a user would. Takes screenshots at each step.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/', label: 'glot.it' },
  { name: 'twm',   url: 'http://localhost:4888/the-wanting-mind/', label: 'The Wanting Mind' },
];

let TOTAL_PASS = 0, TOTAL_FAIL = 0;
const FINDINGS = [];

const log  = (icon, app, msg) => console.log(`${icon} [${app}] ${msg}`);
const pass = (app, msg) => { TOTAL_PASS++; log('✅', app, msg); };
const fail = (app, msg) => { TOTAL_FAIL++; log('❌', app, msg); FINDINGS.push({ app, msg }); };
const info = (app, msg) => log('ℹ️ ', app, msg);
const warn = (app, msg) => log('⚠️ ', app, msg);

async function shot(page, name) {
  const f = path.join(DIR, `pdca-full-${name}.png`);
  await page.screenshot({ path: f, fullPage: false }).catch(() => {});
  return f;
}
async function cropTop(page, name, h = 80) {
  const f = path.join(DIR, `pdca-full-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280, height: h } }).catch(() => {});
  return f;
}

// ─── Shadow DOM helpers ───────────────────────────────────────────────────────
function evalBannerInfo() {
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    const b = sr.querySelector('.mushi-banner');
    if (!b) continue;
    const btns = Array.from(b.querySelectorAll('button, .mushi-banner-link, .mushi-banner-btn'));
    const rect = b.getBoundingClientRect();
    return {
      found: true,
      visible: rect.height > 0,
      height: rect.height,
      y: rect.y,
      variant: b.className,
      buttons: btns.map(x => x.textContent?.trim()),
      hasMyReports: btns.some(x => /my reports/i.test(x.textContent ?? '')),
      hasBugBtn:    btns.some(x => /report.*bug/i.test(x.textContent ?? '')),
      hasFeatBtn:   btns.some(x => /feature|request/i.test(x.textContent ?? '')),
    };
  }
  return { found: false };
}

function evalWidgetInfo() {
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    // Find the outer panel container
    const allText = sr.textContent ?? '';
    const panelEl = sr.querySelector('[class*="panel"], [class*="widget"], [class*="mushi-p"]');
    const isOpen = panelEl ? (panelEl.getBoundingClientRect().height > 0) : allText.length > 50;
    return { isOpen, allText: allText.slice(0, 600) };
  }
  return { isOpen: false, allText: '' };
}

function evalClickInBanner(textPattern) {
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    const b = sr.querySelector('.mushi-banner');
    if (!b) continue;
    const re = new RegExp(textPattern, 'i');
    const btn = Array.from(b.querySelectorAll('button, .mushi-banner-link, .mushi-banner-btn'))
      .find(x => re.test(x.textContent ?? ''));
    if (btn) { btn.click(); return true; }
  }
  return false;
}

function evalClickInWidget(textPattern) {
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    const re = new RegExp(textPattern, 'i');
    const btn = Array.from(sr.querySelectorAll('button, a, [role="button"]'))
      .find(x => re.test(x.textContent ?? ''));
    if (btn) { btn.click(); return true; }
  }
  return false;
}

function evalCloseWidget() {
  for (const el of document.querySelectorAll('*')) {
    const sr = el.shadowRoot;
    if (!sr) continue;
    const btn = sr.querySelector('[aria-label*="Close"], [aria-label*="close"], .mushi-close, [data-action="close"]');
    if (btn) { btn.click(); return true; }
    // fallback: find × button
    const closeX = Array.from(sr.querySelectorAll('button')).find(b => b.textContent?.trim() === '✕' || b.textContent?.trim() === '×');
    if (closeX) { closeX.click(); return true; }
  }
  return false;
}

function evalBodyNudge() {
  const pad = getComputedStyle(document.body).paddingTop;
  const offset = getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim();
  return { pad, offset, active: parseInt(pad) > 0 };
}

function evalClearMushiCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith('mushi:')) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
  return keys;
}

// ─── Per-app test ─────────────────────────────────────────────────────────────
async function testApp(page, app) {
  const { name, url, label } = app;
  info(label, `--- Starting PDCA test for ${label} ---`);

  const consoleErrors = [];
  const networkFails = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    if (r.status() >= 400 && !r.url().includes('analytics') && !r.url().includes('favicon'))
      networkFails.push(`${r.status()} ${r.url().split('?')[0].slice(-60)}`);
  });

  // ── 1. Load and clear Mushi cache ──────────────────────────────────────────
  info(label, '1. Loading and clearing Mushi SDK cache...');
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Clear cache, reload fresh
  const cleared = await page.evaluate(evalClearMushiCache);
  info(label, `Cleared ${cleared.length} mushi: cache entries`);
  await page.reload({ waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(4000);
  await cropTop(page, `${name}-01-load`);
  pass(label, 'Page loaded and Mushi cache cleared');

  // ── 2. Wait for banner to appear (up to 15s) ────────────────────────────────
  info(label, '2. Waiting for Mushi banner...');
  let banner = await page.evaluate(evalBannerInfo);
  for (let i = 0; i < 7 && !banner.found; i++) {
    await page.waitForTimeout(2000);
    banner = await page.evaluate(evalBannerInfo);
  }
  await cropTop(page, `${name}-02-banner`);

  if (!banner.found) {
    fail(label, 'Banner NOT found after 14s wait');
    await shot(page, `${name}-02-nobanner-fullpage`);
    return; // can't continue without banner
  }
  if (!banner.visible) {
    fail(label, `Banner found in DOM but not visible (height=${banner.height})`);
  } else {
    pass(label, `Banner visible at y=${banner.y}, height=${banner.height}px`);
  }

  // ── 3. Variant check ────────────────────────────────────────────────────────
  info(label, `3. Variant: "${banner.variant}"`);
  if (/neon/.test(banner.variant)) {
    pass(label, 'Variant is NEON ✓');
  } else if (/brand/.test(banner.variant)) {
    fail(label, `Variant is "brand" not "neon" — server config fix may not have applied`);
  } else {
    warn(label, `Unexpected variant: "${banner.variant}"`);
  }

  // ── 4. Button inventory ─────────────────────────────────────────────────────
  info(label, `4. Buttons found: ${JSON.stringify(banner.buttons)}`);
  if (banner.hasBugBtn)    pass(label, '"Report a bug" button present');
  else                      fail(label, '"Report a bug" button MISSING');

  if (banner.hasMyReports) {
    pass(label, '"📬 My reports" button present in banner');
  } else {
    fail(label, `"My reports" button NOT in banner — new SDK build not loaded. Buttons: ${JSON.stringify(banner.buttons)}`);
  }

  // ── 5. Body nudge (no header overlap) ───────────────────────────────────────
  info(label, '5. Checking body nudge...');
  const nudge = await page.evaluate(evalBodyNudge);
  info(label, `padding-top: ${nudge.pad}, --mushi-banner-offset: ${nudge.offset}`);
  if (nudge.active) {
    pass(label, `Banner offset active (${nudge.pad}) — page content pushed down, no overlap`);
  } else {
    fail(label, 'No body nudge — banner may overlap page content');
  }
  await cropTop(page, `${name}-05-nudge`, 120);

  // ── 6. Click "📬 My reports" → reports list ─────────────────────────────────
  if (banner.hasMyReports) {
    info(label, '6. Clicking "📬 My reports"...');
    const clicked = await page.evaluate(evalClickInBanner, 'my reports');
    if (!clicked) {
      fail(label, 'Could not click "My reports" button');
    } else {
      await page.waitForTimeout(3000);
      await shot(page, `${name}-06-myreports-clicked`);
      const widget = await page.evaluate(evalWidgetInfo);
      info(label, `Widget text: "${widget.allText.slice(0, 200)}"`);
      if (/your reports|my reports|no reports yet|submitted|classified|triaged/i.test(widget.allText)) {
        pass(label, '"My reports" opens the reporter history view');
      } else if (/what.*happening|category|bug report|feature/i.test(widget.allText)) {
        fail(label, '"My reports" opened the REPORT FORM instead of history — openReporter() not working');
      } else if (widget.isOpen || widget.allText.length > 50) {
        warn(label, `Widget opened but content unclear. Text: "${widget.allText.slice(0, 150)}"`);
      } else {
        fail(label, 'Widget did not open after clicking "My reports"');
      }

      // Close the widget
      await page.evaluate(evalCloseWidget);
      await page.waitForTimeout(1000);
    }
  } else {
    info(label, '6. Skipped — "My reports" button not rendered (build not loaded)');
  }

  // ── 7. "Report a bug" → form → submit → "Track this report" ────────────────
  info(label, '7. Testing full report submission flow...');
  const bugClicked = await page.evaluate(evalClickInBanner, 'report.*bug|bug');
  if (!bugClicked) {
    fail(label, '"Report a bug" could not be clicked');
  } else {
    await page.waitForTimeout(2000);
    await shot(page, `${name}-07-report-form`);
    const form = await page.evaluate(evalWidgetInfo);
    if (/what.*happening|category|describe|tell us/i.test(form.allText)) {
      pass(label, 'Report form opened correctly');
    } else {
      warn(label, `Form opened but content unexpected: "${form.allText.slice(0, 150)}"`);
    }

    // Walk through the form: pick a category
    const catClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        // try clicking a category button (first visible category-like button)
        const btns = Array.from(sr.querySelectorAll('button, [role="button"]'))
          .filter(b => b.getBoundingClientRect().height > 0 &&
                       !/(close|dismiss|back|my reports)/i.test(b.textContent ?? ''));
        for (const btn of btns) {
          const text = btn.textContent?.trim() ?? '';
          if (text.length > 0 && text.length < 40) {
            btn.click();
            return `clicked: "${text}"`;
          }
        }
      }
      return null;
    });
    info(label, `Category step: ${catClicked}`);
    await page.waitForTimeout(1500);

    // Type description
    const typed = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        const ta = sr.querySelector('textarea');
        if (ta) {
          ta.focus();
          ta.value = 'PDCA automated test report — please ignore';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    });
    if (typed) {
      info(label, 'Filled description textarea');
      await page.waitForTimeout(800);
      await shot(page, `${name}-07-form-filled`);
    }

    // Submit
    const submitted = await page.evaluate(evalClickInWidget, 'submit|send');
    if (submitted) {
      await page.waitForTimeout(3000);
      await shot(page, `${name}-07-after-submit`);
      const afterSubmit = await page.evaluate(evalWidgetInfo);
      info(label, `Post-submit text: "${afterSubmit.allText.slice(0, 200)}"`);
      if (/thank|submitted|received|success|track/i.test(afterSubmit.allText)) {
        pass(label, 'Report submitted — success state shown');
        // Check for "Track this report" button
        if (/track.*report|view.*report|my reports/i.test(afterSubmit.allText)) {
          pass(label, '"Track this report" button visible on success screen');
          // Click it
          const trackClicked = await page.evaluate(evalClickInWidget, 'track.*report|view.*report');
          if (trackClicked) {
            await page.waitForTimeout(2000);
            await shot(page, `${name}-07-track-clicked`);
            const trackView = await page.evaluate(evalWidgetInfo);
            if (/your reports|submitted|classified|triaged/i.test(trackView.allText)) {
              pass(label, '"Track this report" opens reporter history ✓');
            } else {
              warn(label, `Track clicked but content: "${trackView.allText.slice(0, 150)}"`);
            }
          }
        } else {
          warn(label, '"Track this report" button text not detected on success screen');
        }
      } else {
        warn(label, `Submit may not have worked. Post-submit text: "${afterSubmit.allText.slice(0, 150)}"`);
      }
    } else {
      warn(label, 'Submit button not found — form may not be complete or widget is on a different step');
    }
  }

  // ── 8. Console errors ────────────────────────────────────────────────────────
  info(label, '8. Console + network check...');
  const mushiErr = consoleErrors.filter(e => /mushi|TypeError|uncaught exception/i.test(e));
  if (mushiErr.length === 0) pass(label, 'No Mushi-related console errors');
  else fail(label, `Console errors: ${mushiErr.slice(0, 2).join(' | ')}`);

  const critNet = networkFails.filter(f => !/analytics|tracking|favicon|sentry\.io/.test(f));
  if (critNet.length === 0) pass(label, 'No critical network failures');
  else warn(label, `Network issues (non-critical): ${critNet.slice(0, 3).join(' | ')}`);

  await shot(page, `${name}-99-final`);
  info(label, `--- Done ---`);
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 250 });

for (const app of APPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await testApp(page, app);
  } catch (err) {
    fail(app.label, `Uncaught: ${err.message}`);
    console.error(err);
  } finally {
    await shot(page, `${app.name}-99-final`).catch(() => {});
    await page.close();
  }
}

await browser.close();

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`PDCA FINAL: ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed`);
if (FINDINGS.length > 0) {
  console.log('\nFINDINGS REQUIRING FIXES:');
  FINDINGS.forEach((f, i) => console.log(`  ${i+1}. [${f.app}] ${f.msg}`));
}
if (TOTAL_FAIL > 0) process.exit(1);
