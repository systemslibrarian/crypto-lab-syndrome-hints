import { test } from '@playwright/test';
import { boot, driveAllStates, expectBaselineNotStale, NARROW } from './gate';

/**
 * WCAG A/AA regression gate for Syndrome Hints.
 *
 * Twenty-three states per theme at desktop and phone width: every meter
 * palette the hint slider produces rather than only the parked maximum, both
 * solvers run for real, the comparative run, the run log reset to its empty
 * rendering, both attacker/omniscient views of the error vector, the
 * hand-decode disclosure in its closed, open, no-match, cleared and MATCHING
 * states, both toy schemes, the noise slider at both ends, and each of the four
 * disclosures opened one at a time instead of all four forced open together.
 *
 * See `gate.ts` for why nothing is injected into the page, why each scan
 * asserts its content first, and why `violations` is not the whole oracle.
 */

for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(900_000);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expectBaselineNotStale();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expectBaselineNotStale();
  });
}
