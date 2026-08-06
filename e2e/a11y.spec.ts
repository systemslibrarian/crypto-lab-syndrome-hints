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
      transition-duration:0s!important;transition-delay:0s!important;scroll-behavior:auto!important;
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

async function setSlider(page: Page, id: string, value: string): Promise<void> {
  const slider = page.locator(id);
  await slider.fill(value);
  await slider.dispatchEvent('input');
}

async function driveDemo(page: Page): Promise<void> {
  const runBtn = page.getByRole('button', { name: /run the real isd attack/i });

  // Exercise BOTH real solvers so each result state is in the DOM when axe runs.
  await page.check('#algo-stern');
  await setSlider(page, '#hint-slider', '4');
  await runBtn.click();
  await expect(page.locator('.result-region .meter-badge')).toBeVisible();

  await page.check('#algo-prange');
  await setSlider(page, '#hint-slider', '6');
  await runBtn.click();

  // Attacker view -> planted truth, so both error-row states get scanned.
  await page.getByRole('button', { name: /show planted truth/i }).click();

  // Run both algorithms at once (renders the comparative result + table rows).
  await page.getByRole('button', { name: /run both algorithms/i }).click();
  await expect(page.locator('#run-body tr').first()).toBeVisible();

  // Push both hint sliders to the maximum so the BROKEN/polynomial meter state
  // and the collapsed chart render, then run once more at the floor.
  for (const id of ['#hint-slider', '#hint-slider-2']) {
    const max = (await page.locator(id).getAttribute('max')) ?? '10';
    await setSlider(page, id, max);
  }
  await expect(page.locator('.meter-badge.state-broken').first()).toBeVisible();
  await runBtn.click();

  // Reveal collapsed content (chart data table, hand-decode, explainers, refs).
  await openAllDetails(page);

  // Primer hand-decode (now inside a details): flip a couple of bits + reveal.
  const primerBits = page.locator('.hand-decode button.bit');
  await primerBits.nth(0).click();
  await primerBits.nth(3).click();
  await page.getByRole('button', { name: /reveal the true error/i }).click();

  // Both McEliece-vs-HQC comparison attacks.
  for (const b of await page.getByRole('button', { name: /run isd on the/i }).all()) {
    await b.click();
  }

  // Exercise the approximate-hint noise slider (drives its live readout).
  await setSlider(page, '#noise-slider', '0');
  await setSlider(page, '#noise-slider', '20');

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
