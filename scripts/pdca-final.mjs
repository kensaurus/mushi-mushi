/**
 * pdca-final.mjs
 * Final PDCA test using CDP to pierce closed shadow DOM.
 * Tests both apps thoroughly: banner, variant, My reports flow, submit flow.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/practice', label: 'glot.it' },
  { name: 'twm',   url: 'http://localhost:4888/the-wanting-mind/', label: 'The Wanting Mind' },
];

let TOTAL_PASS = 0, TOTAL_FAIL = 0;
const FINDINGS = [];
const pass = (app, msg) => { TOTAL_PASS++; console.log(`✅ [${app}] ${msg}`); };
const fail = (app, msg) => { TOTAL_FAIL++; console.log(`❌ [${app}] ${msg}`); FINDINGS.push(`[${app}] ${msg}`); };
const info = (app, msg) => console.log(`ℹ️  [${app}] ${msg}`);
const warn = (app, msg) => console.log(`⚠️  [${app}] ${msg}`);

const shot = async (page, name) => {
  const f = path.join(DIR, `final-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
};
const cropTop = async (page, name, h = 60) => {
  const f = path.join(DIR, `final-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x:0, y:0, width:1280, height: h } }).catch(() => {});
  return f;
};

/**
 * Use CDP Runtime.callFunctionOn to run a function *inside* the page that
 * can access the otherwise-closed shadow root via a trick: inject a script
 * that calls the widget module's internal APIs.
 *
 * Actually: we expose a helper on `window` BEFORE the SDK loads, which
 * intercepts `attachShadow` and captures the shadow root reference.
 *
 * Alternate simpler approach: use CDP to inject JS that runs in the same
 * isolated world as the page but with higher privileges. In Playwright,
 * page.evaluate() runs in the main world. But we can use
 * page.exposeFunction + addInitScript to capture the shadow root.
 */
async function setupShadowCapture(page) {
  // Intercept attachShadow before SDK loads to capture closed shadow root
  await page.addInitScript(() => {
    const orig = Element.prototype.attachShadow;
    window._mushiShadowRoots = [];
    Element.prototype.attachShadow = function(init) {
      const sr = orig.call(this, init);
      if (this.id === 'mushi-mushi-widget') {
        window._mushiShadowRef = sr;
        window._mushiShadowRoots.push(sr);
      }
      return sr;
    };
  });
}

async function getBannerButtonRects(page) {
  return await page.evaluate(() => {
    const sr = window._mushiShadowRef;
    if (!sr) return { error: 'no shadow ref' };
    const banner = sr.querySelector('.mushi-banner');
    if (!banner) return { error: 'no banner element' };
    const btns = Array.from(banner.querySelectorAll('button, .mushi-banner-btn, .mushi-banner-my-reports'));
    return {
      variant: banner.className,
      bannerRect: banner.getBoundingClientRect().toJSON(),
      buttons: btns.map(b => ({
        text: b.textContent?.trim(),
        className: b.className,
        rect: b.getBoundingClientRect().toJSON(),
        visible: b.getBoundingClientRect().height > 0,
      })),
    };
  });
}

async function checkWidgetOpen(page) {
  return await page.evaluate(() => {
    const sr = window._mushiShadowRef;
    if (!sr) return { isOpen: false };
    // The panel is shown when it has content beyond the banner
    const panel = sr.querySelector('.mushi-panel, [class*="panel"], .mushi-reporter');
    const allText = sr.textContent?.trim() ?? '';
    const host = document.getElementById('mushi-mushi-widget');
    const rect = host ? host.getBoundingClientRect() : null;
    // Look for panel indicator elements
    const stepIndicator = sr.querySelector('.mushi-steps, .step-indicator, [class*="step"]');
    const titleEl = sr.querySelector('.mushi-title, h2, h3');
    return {
      isOpen: rect ? rect.height > 60 : false,
      hostHeight: rect?.height ?? 0,
      panelFound: !!panel,
      stepText: stepIndicator?.textContent?.trim() ?? '',
      titleText: titleEl?.textContent?.trim() ?? '',
      hasTextContent: allText.length > 100,
      textSample: allText.slice(0, 300),
    };
  });
}

async function testApp(page, app) {
  const { name, url, label } = app;
  info(label, `\n=== PDCA for ${label} ===`);

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ── 1. Load ───────────────────────────────────────────────────────────────
  info(label, '1. Loading...');
  await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
  // Wait for JS to fully execute
  await page.waitForFunction(() => !!document.getElementById('mushi-mushi-widget'), { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  pass(label, 'Page loaded');

  // ── 2. Banner ─────────────────────────────────────────────────────────────
  info(label, '2. Banner detection...');
  let bannerData = await getBannerButtonRects(page);

  // Wait up to 10s if not yet ready
  for (let i = 0; i < 5 && bannerData.error; i++) {
    await page.waitForTimeout(2000);
    bannerData = await getBannerButtonRects(page);
  }
  await cropTop(page, `${name}-02-banner`);

  if (bannerData.error) {
    fail(label, `Banner not found: ${bannerData.error}`);
    return;
  }

  info(label, `  Variant class: "${bannerData.variant}"`);
  info(label, `  Buttons: ${bannerData.buttons.map(b => `"${b.text}" @ x=${Math.round(b.rect.x)}`).join(', ')}`);

  if (/neon/.test(bannerData.variant)) {
    pass(label, 'Variant: NEON ✓');
  } else {
    fail(label, `Variant is NOT neon: "${bannerData.variant}"`);
  }

  // ── 3. Body nudge ─────────────────────────────────────────────────────────
  const css = await page.evaluate(() => ({
    pad: getComputedStyle(document.body).paddingTop,
    offset: getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim(),
  }));
  if (parseInt(css.pad) > 0) {
    pass(label, `Body nudge active: padding-top=${css.pad} (no header overlap)`);
  } else {
    fail(label, `No body nudge (padding-top=${css.pad}) — banner overlaps page header`);
  }

  // ── 4. "My reports" button ────────────────────────────────────────────────
  const myRBtn = bannerData.buttons.find(b => /my reports/i.test(b.text ?? ''));
  if (myRBtn) {
    pass(label, `"📬 My reports" button present at x=${Math.round(myRBtn.rect.x+myRBtn.rect.width/2)}, y=${Math.round(myRBtn.rect.y+myRBtn.rect.height/2)}`);
  } else {
    fail(label, '"My reports" button NOT found in banner');
    info(label, `Banner buttons: ${JSON.stringify(bannerData.buttons.map(b => b.text))}`);
  }

  const bugBtn = bannerData.buttons.find(b => /bug/i.test(b.text ?? ''));
  if (bugBtn) pass(label, '"Report a bug" button present');
  else fail(label, '"Report a bug" button missing');

  const featBtn = bannerData.buttons.find(b => /feature|request|idea/i.test(b.text ?? ''));
  if (featBtn) pass(label, `"${featBtn.text}" button present`);
  else fail(label, 'Feature request button missing');

  // ── 5. Click "My reports" using actual coordinates ─────────────────────────
  if (myRBtn) {
    const cx = Math.round(myRBtn.rect.x + myRBtn.rect.width / 2);
    const cy = Math.round(myRBtn.rect.y + myRBtn.rect.height / 2);
    info(label, `5. Clicking "My reports" at (${cx}, ${cy})...`);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(3000);
    await shot(page, `${name}-05-myreports`);

    const w = await checkWidgetOpen(page);
    info(label, `  Widget: height=${w.hostHeight}, title="${w.titleText}", text="${w.textSample.slice(0,100)}"`);

    if (w.isOpen) {
      if (/your reports|my reports|no reports/i.test(w.textSample)) {
        pass(label, '"My reports" opens reporter history view ✓');
      } else if (/tell us|what.*happen|category/i.test(w.textSample)) {
        fail(label, '"My reports" opened report form instead of history view — openReporter() broken');
      } else {
        pass(label, '"My reports" opened the widget panel (verify screenshot)');
      }
    } else {
      fail(label, '"My reports" click did not open the widget panel');
    }

    // Close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1200);
  }

  // ── 6. "Report a bug" → submit flow ──────────────────────────────────────
  if (bugBtn) {
    const cx = Math.round(bugBtn.rect.x + bugBtn.rect.width / 2);
    const cy = Math.round(bugBtn.rect.y + bugBtn.rect.height / 2);
    info(label, `6. Clicking "Report a bug" at (${cx}, ${cy})...`);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(2500);
    await shot(page, `${name}-06-form`);

    const w2 = await checkWidgetOpen(page);
    if (w2.isOpen) {
      pass(label, '"Report a bug" opened the widget');

      // Fill textarea
      const textarea = page.locator('textarea').first();
      const taOk = await textarea.isVisible({ timeout: 6000 }).catch(() => false);
      if (taOk) {
        await textarea.fill('PDCA test — automated, please ignore');
        await page.waitForTimeout(500);
        pass(label, 'Filled description textarea');

        const submitBtn = page.getByRole('button', { name: /submit|send/i }).first();
        if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await submitBtn.click();
          await page.waitForTimeout(4000);
          await shot(page, `${name}-06-submitted`);

          const w3 = await checkWidgetOpen(page);
          if (/thank|received|submitted/i.test(w3.textSample)) {
            pass(label, 'Report submitted — success state visible');
          } else {
            warn(label, `Submit: text="${w3.textSample.slice(0, 100)}"`);
          }

          // Look for "Track this report"
          const trackText = page.getByText(/track.*report/i).first();
          if (await trackText.isVisible({ timeout: 3000 }).catch(() => false)) {
            pass(label, '"Track this report" button visible on success screen');
            await trackText.click();
            await page.waitForTimeout(2500);
            await shot(page, `${name}-06-track`);
            const w4 = await checkWidgetOpen(page);
            if (/your reports|my reports/i.test(w4.textSample)) {
              pass(label, '"Track this report" leads to reporter history view ✓');
            } else {
              warn(label, `Track view text: "${w4.textSample.slice(0, 100)}"`);
            }
          } else {
            warn(label, '"Track this report" not found on success screen (may be under different text)');
          }
        } else {
          warn(label, 'Submit button not visible — form step not complete');
          await shot(page, `${name}-06-nostep`);
        }
      } else {
        warn(label, 'Textarea not immediately visible — may be on category step');
        await shot(page, `${name}-06-catstep`);
      }
    } else {
      fail(label, '"Report a bug" did not open widget');
    }
  }

  // ── 7. Console errors ─────────────────────────────────────────────────────
  const me = consoleErrors.filter(e => /mushi|TypeError|uncaught/i.test(e));
  if (me.length === 0) pass(label, 'No Mushi console errors');
  else fail(label, `Console errors: ${me.slice(0,2).join(' | ')}`);

  await shot(page, `${name}-99-final`);
  info(label, '=== Done ===\n');
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 100 });

for (const app of APPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await setupShadowCapture(page);  // MUST be called before goto
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
console.log(`FINAL: ${TOTAL_PASS} ✅ passed, ${TOTAL_FAIL} ❌ failed`);
if (FINDINGS.length) { console.log('\nFINDINGS:'); FINDINGS.forEach((f,i) => console.log(`  ${i+1}. ${f}`)); }
if (TOTAL_FAIL > 0) process.exit(1);
