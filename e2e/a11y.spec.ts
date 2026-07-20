import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Strict WCAG regression gate for Syndrome Hints.
 *
 * The app renders every panel from src/main.ts: a syndrome-decoding primer with
 * a clickable candidate error, a hint slider that drives an attack meter and the
 * work-factor chart, an approximate-hint model panel, and a McEliece-vs-HQC
 * comparison with per-scheme "Run" buttons. Axe only sees what is in the DOM, so
 * before scanning we DRIVE every panel into its post-interaction state:
 *   - flip the primer candidate + reveal the true error,
 *   - push both hint sliders to max (renders the DRAINING/BROKEN meter states,
 *     the collapsed chart, and the measured overlay),
 *   - run the real ISD attack and both comparison attacks,
 *   - exercise the approximate-hint noise slider,
 *   - open every <details>,
 *   - neutralise animation/transition/opacity so mid-flight states can't hide
 *     text from the contrast checker.
 * Both themes are scanned for zero WCAG 2.0/2.1 A + AA violations.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function killMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*,*::before,*::after{
      animation-duration:0s!important;animation-delay:0s!important;
      transition-duration:0s!important;transition-delay:0s!important;
      opacity:1!important;scroll-behavior:auto!important;
    }`,
  });
}

async function openAllDetails(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) {
      (d as HTMLDetailsElement).open = true;
    }
  });
}

async function driveDemo(page: Page): Promise<void> {
  // Primer: flip a couple of candidate bits, then reveal the true error.
  const primerBits = page.locator('.bit-row').first().locator('button.bit');
  await primerBits.nth(0).click();
  await primerBits.nth(3).click();
  await page.getByRole('button', { name: /reveal the true error/i }).click();

  const runBtn = page.getByRole('button', { name: /run the real isd attack/i });

  // Exercise BOTH real solvers so each result region is in the DOM when axe
  // runs. Stern first (at a few hints), then Prange (at more hints). Running at
  // a mid-to-high hint count keeps each real decode fast on the CI runner.
  await page.check('#algo-stern');
  await page.locator('#hint-slider').fill('4');
  await page.locator('#hint-slider').dispatchEvent('input');
  await runBtn.click();
  await expect(page.locator('.result-region .meter-badge')).toBeVisible();

  await page.check('#algo-prange');
  await page.locator('#hint-slider').fill('6');
  await page.locator('#hint-slider').dispatchEvent('input');
  await runBtn.click();

  // Push both hint sliders to their maximum so the BROKEN/polynomial meter
  // state and the collapsed chart render, then run once more at the floor.
  for (const id of ['#hint-slider', '#hint-slider-2']) {
    const slider = page.locator(id);
    const max = (await slider.getAttribute('max')) ?? '10';
    await slider.fill(max);
    await slider.dispatchEvent('input');
  }
  await expect(page.locator('.meter-badge.state-broken').first()).toBeVisible();
  await runBtn.click();

  // Both McEliece-vs-HQC comparison attacks.
  for (const b of await page.getByRole('button', { name: /run isd on the/i }).all()) {
    await b.click();
  }

  // Exercise the approximate-hint noise slider (drives its live readout).
  const noise = page.locator('#noise-slider');
  await noise.fill('0');
  await noise.dispatchEvent('input');
  await noise.fill('20');
  await noise.dispatchEvent('input');

  await page.waitForTimeout(200);
}

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
  }));
  expect(summary).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#cl-theme-toggle')).toBeVisible();
  await expect(page.locator('#hint-slider')).toBeVisible();
  await killMotion(page);
});

test('no WCAG A/AA violations in dark theme', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await driveDemo(page);
  await openAllDetails(page);
  await killMotion(page);
  await scan(page);
});

test('no WCAG A/AA violations in light theme', async ({ page }) => {
  await page.locator('#cl-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await driveDemo(page);
  await openAllDetails(page);
  await killMotion(page);
  await scan(page);
});
