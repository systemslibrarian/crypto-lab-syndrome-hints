import { expect, test, type Page } from '@playwright/test';

/**
 * Behaviour contract for the experiment. axe cannot check that the right solver
 * ran, that results verify, that the sliders stay in sync, or that the layout
 * doesn't overflow on a phone — these do.
 */

async function setSlider(page: Page, id: string, value: string): Promise<void> {
  const s = page.locator(id);
  await s.fill(value);
  await s.dispatchEvent('input');
}

test.beforeEach(async ({ page }) => {
  await page.goto('.');
  await expect(page.locator('#hint-slider')).toBeVisible();
});

test('selecting an algorithm runs THAT solver, and the result verifies H·e=s', async ({ page }) => {
  await page.check('#algo-stern');
  await setSlider(page, '#hint-slider', '3');
  await page.getByRole('button', { name: /run the real isd attack/i }).click();

  const firstRow = page.locator('#run-body tr').first();
  await expect(firstRow).toContainText('Stern');
  await expect(firstRow).toContainText('H·e=s');
  await expect(firstRow.locator('.cmp-pass')).toBeVisible();

  await page.check('#algo-prange');
  await page.getByRole('button', { name: /run the real isd attack/i }).click();
  await expect(page.locator('#run-body tr').first()).toContainText('Prange');
});

test('the two hint sliders stay in sync', async ({ page }) => {
  await setSlider(page, '#hint-slider', '5');
  await expect(page.locator('#hint-slider-2')).toHaveValue('5');
  await setSlider(page, '#hint-slider-2', '8');
  await expect(page.locator('#hint-slider')).toHaveValue('8');
});

test('Run both adds one row per algorithm; Reset clears them', async ({ page }) => {
  await setSlider(page, '#hint-slider', '4');
  await page.getByRole('button', { name: /run both algorithms/i }).click();
  await expect(page.locator('#run-body tr')).toHaveCount(2);
  const algos = await page.locator('#run-body tr td:nth-child(2)').allInnerTexts();
  expect(algos.sort()).toEqual(['Prange', 'Stern']);

  await page.getByRole('button', { name: /reset runs/i }).click();
  await expect(page.locator('#run-body')).toContainText('No runs yet');
});

test('full support leakage drives the BROKEN / polynomial state', async ({ page }) => {
  const max = (await page.locator('#hint-slider').getAttribute('max')) ?? '11';
  await setSlider(page, '#hint-slider', max);
  await expect(page.locator('.meter-badge.state-broken').first()).toBeVisible();
});

test('attacker view hides the secret; Show planted truth reveals it', async ({ page }) => {
  // Before revealing, at 0 hints every coordinate is unknown to the attacker.
  await setSlider(page, '#hint-slider', '0');
  await expect(page.locator('.bit-row .bit.unknown').first()).toBeVisible();
  await page.getByRole('button', { name: /show planted truth/i }).click();
  await expect(page.locator('.bit-row .bit.support').first()).toBeVisible();
});

test('no horizontal overflow at a 375px phone width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('.');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
