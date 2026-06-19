/**
 * pdca-full-v2.mjs
 * Comprehensive PDCA using Playwright locators (pierce closed shadow DOM).
 * glot.it → /practice to bypass onboarding.
 * TWM → /the-wanting-mind/ (no onboarding overlay).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const APPS = [
  {
    name:    'glotit',
    url:     'http://localhost:3847/glot-it/practice',  // bypass onboarding
    label:   'glot.it',
    overlay: null,
  },
  {
    name:    'twm',
    url:     'http://localhost:4888/the-wanting-mind/',
    label:   'The Wanting Mind',
    overlay: 'Choose your language',  // language picker to dismiss first
  },
];

let TOTAL_PASS = 0, TOTAL_FAIL = 0;
const FINDINGS = [];

const log  = (icon, app, msg) => console.log(`${icon} [${app}] ${msg}`);
const pass = (app, msg) => { TOTAL_PASS++; log('✅', app, msg); };
const fail = (app, msg) => { TOTAL_FAIL++; log('❌', app, msg); FINDINGS.push({ app, msg }); };
const info = (app, msg) => log('ℹ️ ', app, msg);
const warn = (app, msg) => log('⚠️ ', app, msg);

async function shot(page, name) {
  const f = path.join(DIR, `pdca2-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}
async function cropTop(page, name, h = 60) {
  const f = path.join(DIR, `pdca2-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280, height: h } }).catch(() => {});
  return f;
}

// ─── per-app ─────────────────────────────────────────────────────────────────
async function testApp(page, app) {
  const { name, url, label, overlay } = app;
  info(label, `=== Starting PDCA for ${label} (${url}) ===`);

  const consoleErrors = [];
  const networkFails  = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', r => {
    const s = r.status();
    const u = r.url();
    if (s >= 400 && !/analytics|tracking|favicon|sentry\.io/.test(u))
      networkFails.push(`${s} ${u.split('?')[0].slice(-60)}`);
  });

  // ── 1. Load page ─────────────────────────────────────────────────────────
  info(label, '1. Loading page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(3000);
  pass(label, 'Page loaded');

  // Dismiss overlay if present (TWM language picker)
  if (overlay) {
    try {
      const overlayText = page.getByText(overlay).first();
      if (await overlayText.isVisible({ timeout: 3000 })) {
        info(label, `Dismissing "${overlay}" overlay via Continue button...`);
        const continueBtn = page.getByRole('button', { name: /continue/i }).first();
        await continueBtn.click({ timeout: 5000 });
        await page.waitForTimeout(2000);
        pass(label, 'Overlay dismissed');
      }
    } catch {
      info(label, 'No overlay found or already dismissed');
    }
  }

  await page.waitForTimeout(3000);
  await cropTop(page, `${name}-01-load`);

  // ── 2. Banner presence (Playwright locator pierces closed shadow) ─────────
  info(label, '2. Checking for Mushi banner...');
  const bannerLocator = page.locator('.mushi-banner');
  let bannerVisible = false;
  for (let i = 0; i < 6; i++) {
    try {
      bannerVisible = await bannerLocator.isVisible({ timeout: 3000 });
      if (bannerVisible) break;
    } catch {}
    await page.waitForTimeout(2000);
  }

  await cropTop(page, `${name}-02-banner`);

  if (!bannerVisible) {
    fail(label, 'Banner NOT visible after 15s');
    // Check if it exists but hidden (maybe hideOnSelector fired)
    const bannerExists = await bannerLocator.count() > 0;
    info(label, `Banner exists in DOM: ${bannerExists}`);
    await shot(page, `${name}-02-full`);
    // continue anyway to test other things
  } else {
    pass(label, 'Banner is visible');

    // ── 3. Variant ───────────────────────────────────────────────────────────
    const neon = page.locator('.mushi-banner.neon');
    if (await neon.isVisible({ timeout: 2000 }).catch(() => false)) {
      pass(label, 'Variant: NEON ✓');
    } else {
      const brand = page.locator('.mushi-banner.brand');
      if (await brand.isVisible({ timeout: 2000 }).catch(() => false)) {
        fail(label, 'Variant is BRAND, not neon — server config fix may not have applied');
      } else {
        warn(label, 'Could not determine variant from class');
      }
    }
  }

  // ── 4. "My reports" button in banner ────────────────────────────────────────
  info(label, '4. Looking for "My reports" button...');
  const myReportsBtn = page.locator('.mushi-banner-my-reports');
  const myReportsVisible = await myReportsBtn.isVisible({ timeout: 2000 }).catch(() => false);
  const myReportsAlt = page.getByText('My reports').first();
  const myReportsAltVisible = await myReportsAlt.isVisible({ timeout: 2000 }).catch(() => false);

  if (myReportsVisible || myReportsAltVisible) {
    pass(label, '"📬 My reports" button IS visible in the banner');
  } else {
    fail(label, '"My reports" button NOT found — new SDK build not loaded in running dev server');
    info(label, 'All banner buttons:');
    const bugBtn = page.locator('.mushi-banner-btn').first();
    const bugText = await bugBtn.textContent().catch(() => '?');
    info(label, `  First button text: "${bugText}"`);
  }

  await cropTop(page, `${name}-04-banner-buttons`);

  // ── 5. Body nudge / no overlap ───────────────────────────────────────────────
  info(label, '5. Checking body nudge (no header overlap)...');
  const { pad, offset } = await page.evaluate(() => ({
    pad:    getComputedStyle(document.body).paddingTop,
    offset: getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim(),
  }));
  info(label, `padding-top: ${pad}  --mushi-banner-offset: ${offset}`);
  if (parseInt(pad) > 0 || offset) {
    pass(label, `Banner offset active — page content pushed down correctly (${pad})`);
  } else {
    fail(label, 'No body nudge — banner overlaps page content');
  }

  // ── 6. Click "My reports" → opens reports history ───────────────────────────
  if (myReportsVisible || myReportsAltVisible) {
    info(label, '6. Clicking "My reports" button...');
    try {
      if (myReportsVisible) await myReportsBtn.click({ timeout: 3000 });
      else await myReportsAlt.click({ timeout: 3000 });

      await page.waitForTimeout(3000);
      await shot(page, `${name}-06-myreports-opened`);

      // Check for "Your reports" heading or similar text in the opened widget
      const reportsHeading = page.getByText(/your reports/i).first();
      const noReports      = page.getByText(/no reports yet|nothing yet/i).first();
      const reportItem     = page.locator('.mushi-report-row, [data-report-id]').first();
      const submittedItem  = page.getByText(/submitted|triaged|classified/i).first();

      if (await reportsHeading.isVisible({ timeout: 4000 }).catch(() => false)) {
        pass(label, '"Your reports" view opened — heading visible');
      } else if (await noReports.isVisible({ timeout: 2000 }).catch(() => false)) {
        pass(label, '"Your reports" view opened — "no reports yet" message visible (correct for fresh session)');
      } else if (await reportItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        pass(label, '"Your reports" view opened — report items visible');
      } else if (await submittedItem.isVisible({ timeout: 2000 }).catch(() => false)) {
        pass(label, '"Your reports" view opened — report status text visible');
      } else {
        // Screenshot to see what opened
        const widgetContent = await page.locator('[id="mushi-mushi-widget"]').textContent().catch(() => 'N/A');
        warn(label, `Widget opened but unclear if on reports view. Try screenshot for visual check.`);
        info(label, `Accessible text of widget host: "${widgetContent?.slice(0, 100)}"`);
      }

      // Close widget for next test
      const closeBtn = page.locator('[aria-label*="Close"], [aria-label*="close"]').first();
      await closeBtn.click({ timeout: 3000 }).catch(async () => {
        await page.keyboard.press('Escape').catch(() => {});
      });
      await page.waitForTimeout(1000);

    } catch (err) {
      fail(label, `Error clicking "My reports": ${err.message.slice(0, 80)}`);
    }
  } else {
    info(label, '6. Skipped (button not found)');
  }

  // ── 7. "Report a bug" → form → description → submit ─────────────────────────
  info(label, '7. Testing Report a bug → submit flow...');
  const bugBtnLocator = page.locator('.mushi-banner-btn').first();
  const bugVisible = await bugBtnLocator.isVisible({ timeout: 3000 }).catch(() => false);
  if (bugVisible) {
    await bugBtnLocator.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    await shot(page, `${name}-07-bug-form`);
    pass(label, '"Report a bug" button clicked, widget opened');

    // Look for a description textarea
    const textarea = page.locator('textarea').first();
    const taVisible = await textarea.isVisible({ timeout: 5000 }).catch(() => false);

    if (!taVisible) {
      // Maybe on a category step first — click first visible category-like button
      const catBtns = page.locator('.mushi-intent, .mushi-category, [class*="intent"]');
      const count = await catBtns.count();
      if (count > 0) {
        await catBtns.first().click().catch(() => {});
        await page.waitForTimeout(1500);
        info(label, 'Clicked category step');
      }
      // Try a second time
      const taVisible2 = await textarea.isVisible({ timeout: 3000 }).catch(() => false);
      if (!taVisible2) {
        warn(label, 'Textarea not found — widget may need category selection first');
        await shot(page, `${name}-07-form-step`);
      }
    }

    const taFinal = await textarea.isVisible({ timeout: 3000 }).catch(() => false);
    if (taFinal) {
      await textarea.fill('PDCA automated test — please ignore.', { timeout: 3000 });
      pass(label, 'Filled description textarea');
      await page.waitForTimeout(500);
      await shot(page, `${name}-07-filled`);

      const submitBtn = page.getByRole('button', { name: /submit|send/i }).first();
      const submitVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
      if (submitVisible) {
        await submitBtn.click({ timeout: 3000 });
        await page.waitForTimeout(3000);
        await shot(page, `${name}-07-submitted`);

        // Check for success state
        const thankText = page.getByText(/thank|received|submitted|success/i).first();
        const trackBtn  = page.getByText(/track.*report|view.*report/i).first();
        if (await thankText.isVisible({ timeout: 4000 }).catch(() => false)) {
          pass(label, 'Report submitted — success state visible');
        } else {
          warn(label, 'Success text not found after submit');
        }

        if (await trackBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          pass(label, '"Track this report" button visible on success screen');
          await trackBtn.click({ timeout: 3000 });
          await page.waitForTimeout(2500);
          await shot(page, `${name}-07-track`);
          const histHeading = page.getByText(/your reports/i).first();
          if (await histHeading.isVisible({ timeout: 4000 }).catch(() => false)) {
            pass(label, '"Track this report" opens reports history ✓');
          } else {
            warn(label, '"Track" clicked but "Your reports" heading not seen');
          }
        } else {
          warn(label, '"Track this report" button not found on success screen');
        }
      } else {
        warn(label, 'Submit button not visible — form may need more steps');
        await shot(page, `${name}-07-nosubmit`);
      }
    }
  } else {
    warn(label, '"Report a bug" button not visible for submit test');
  }

  // ── 8. Console + network errors ─────────────────────────────────────────────
  info(label, '8. Console + network check...');
  const mushiErr = consoleErrors.filter(e => /mushi|TypeError|uncaught/i.test(e));
  if (mushiErr.length === 0) pass(label, 'No Mushi-related console errors');
  else fail(label, `Console errors: ${mushiErr.slice(0, 2).join(' | ')}`);

  const critNet = networkFails.filter(f => !/preload|chunk|\.map$/.test(f));
  if (critNet.length === 0) pass(label, 'No critical network failures');
  else warn(label, `Network issues: ${critNet.slice(0, 3).join(' | ')}`);

  await shot(page, `${name}-99-final`);
  info(label, `=== Done ===`);
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 200 });

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
  console.log('\nFINDINGS:');
  FINDINGS.forEach((f, i) => console.log(`  ${i+1}. [${f.app}] ${f.msg}`));
}
console.log('\nScreenshots saved to .playwright-mcp/pdca2-*.png');
if (TOTAL_FAIL > 0) process.exit(1);
