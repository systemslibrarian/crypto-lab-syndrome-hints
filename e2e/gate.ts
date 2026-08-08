import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this file
 *     replaces drove a great deal of the page — and then called
 *     `openAllDetails`, forcing all four `<details>` open simultaneously, and
 *     injected `animation-duration: 0s` / `transition-duration: 0s`. All four
 *     disclosures ship CLOSED, so the page it scanned is one no visitor
 *     produces.
 *
 *     More seriously it scanned ONE accumulated end state per theme, at
 *     desktop width, and asserted on axe `violations` alone. This lab's
 *     interesting states overwrite one another: the attack meter has three
 *     palettes (safe / draining / broken), the hand-decode comparison has a
 *     match and a no-match rendering, and the run log's verified column has
 *     both a pass and a fail glyph. Only whichever one happened to be last
 *     was ever measured.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. axe over an empty container passes having checked
 *     nothing, and main.ts builds the ENTIRE page into `#app` at runtime.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This
 * stylesheet declares no `animation` and no `transition` at all, and no
 * `prefers-reduced-motion` block, so there is nothing to cancel and nothing to
 * restore — the check is expected to be silent, and is kept because adding one
 * keyframe would change that.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 *
 * The theme is seeded in `localStorage` rather than reached by clicking the
 * toggle, so the page boots in the theme under test instead of transitioning
 * into it — and the light-theme walk is a fresh load rather than a walk of a
 * page that was mid-transition when the first scan ran.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // Fail fast on an unreachable control. Playwright's default action timeout is
  // the whole test timeout, so a click on something a sticky header covers, or
  // a locator gated on a prerequisite that never ran, silently burns the entire
  // budget instead of pointing at the state it could not reach.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // main.ts builds the WHOLE page into #app at runtime. Scanning before that
  // has happened is scanning one empty div.
  await expect(page.locator('#hint-slider')).toBeVisible();
  await expect(page.locator('#app section.card').first()).toBeVisible();
  await expect(page.locator('#run-body tr')).toHaveCount(1);
  await expect(page.locator('.meter')).not.toBeEmpty();
  await expect(page.locator('svg.chart')).toBeVisible();

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it prints a 48-column parity-check matrix, a 48-button
 * hand-decode row, an eight-column run log and an SVG work-factor chart.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide table inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const widest = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .filter((x) => !clipped(x.el))
      .sort((a, b) => b.r.right - a.r.right)[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  expect(violations, `axe violations in state: ${label}`).toEqual([]);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([]);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  expect(contrast, `measured contrast failures in state: ${label}`).toEqual([]);

  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/**
 * Drive the whole single-page document, scanning each state.
 *
 * Every control is reached. Beyond what the old gate drove, that adds: the
 * "Reset runs" button and the empty run-log rendering it restores, the
 * hand-decode "Clear" button, each `<details>` in BOTH configurations rather
 * than all four forced open, the hand-decode MATCH state (the old drive only
 * ever produced no-match, because it flipped two arbitrary bits), and every
 * intermediate hint count — the meter's safe, draining and broken palettes
 * overwrite one another, so scanning only the parked maximum measured one of
 * three.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  await scan(page, `${theme} / first paint`);

  await page.locator('.cl-skip-link').focus();
  await scan(page, `${theme} / skip link focused`);

  // ── The hint slider: every meter palette, not just the last ────────────
  const slider = page.locator('#hint-slider');
  const maxHints = Number((await slider.getAttribute('max')) ?? '10');
  for (const hints of [0, Math.floor(maxHints / 2), maxHints]) {
    await slider.fill(String(hints));
    await expect(page.locator('.meter-badge').first()).toBeVisible();
    await scan(page, `${theme} / ${hints} of ${maxHints} hints leaked`);
  }

  // ── Both solvers, run for real ─────────────────────────────────────────
  await slider.fill('4');
  await page.locator('#algo-stern').check();
  await page.getByRole('button', { name: /run the real isd attack/i }).click();
  await expect(page.locator('.result-region .meter-badge')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#run-body tr').first()).toBeVisible();
  await scan(page, `${theme} / Stern run at 4 hints`);

  await page.locator('#algo-prange').check();
  await page.locator('#hint-slider').fill('6');
  await page.getByRole('button', { name: /run the real isd attack/i }).click();
  await expect(page.locator('.result-region .meter-badge')).toBeVisible({ timeout: 120_000 });
  await scan(page, `${theme} / Prange run at 6 hints`);

  await page.getByRole('button', { name: /run both algorithms/i }).click();
  await expect(page.locator('#run-body tr').nth(2)).toBeVisible({ timeout: 120_000 });
  await scan(page, `${theme} / both algorithms compared`);

  // Reset returns the run log to its "No runs yet" rendering — a distinct
  // state the old gate never restored, because it never pressed this button.
  await page.getByRole('button', { name: /reset runs/i }).click();
  await expect(page.locator('#run-body tr')).toHaveCount(1);
  await scan(page, `${theme} / run log reset`);

  // ── The attacker's view of the error vector, both ways ─────────────────
  await page.getByRole('button', { name: /show planted truth/i }).click();
  await scan(page, `${theme} / planted truth revealed`);
  await page.getByRole('button', { name: /hide planted truth/i }).click();
  await scan(page, `${theme} / attacker view only`);

  // ── The mirrored slider on the curve card ──────────────────────────────
  await page.locator('#hint-slider-2').fill(String(maxHints));
  await expect(page.locator('.meter-badge.state-broken').first()).toBeVisible();
  await scan(page, `${theme} / hints at the maximum (search broken)`);
  await page.locator('#hint-slider-2').fill('2');
  await scan(page, `${theme} / hints back down to 2`);

  // ── The hand-decode disclosure: closed, open, no-match, and MATCH ──────
  // The old drive flipped two arbitrary bits and revealed, so it only ever
  // scanned the "✗ no match" rendering; the "✓ match" branch is a different
  // element and was never on screen for any scan.
  const handDecode = page.locator('details.hand-decode');
  await handDecode.locator('summary').click();
  await expect(handDecode).toHaveAttribute('open', '');
  await scan(page, `${theme} / hand-decode open, no candidate`);

  const bits = handDecode.locator('button.bit');
  await bits.nth(0).click();
  await bits.nth(3).click();
  await expect(page.locator('.cmp-fail').first()).toBeVisible();
  await scan(page, `${theme} / hand-decode no match`);

  await handDecode.getByRole('button', { name: /^Clear$/ }).click();
  await scan(page, `${theme} / hand-decode cleared`);

  await handDecode.getByRole('button', { name: /reveal the true error/i }).click();
  await expect(handDecode.locator('.cmp-pass')).toBeVisible();
  await scan(page, `${theme} / hand-decode matching the syndrome`);

  await handDecode.getByRole('button', { name: /hide the true error/i }).click();
  await handDecode.locator('summary').click();
  await expect(handDecode).not.toHaveAttribute('open', '');

  // ── The two toy schemes ────────────────────────────────────────────────
  const schemeRuns = page.getByRole('button', { name: /run isd on the/i });
  const schemeCount = await schemeRuns.count();
  expect(schemeCount, 'both toy schemes must offer a run').toBe(2);
  for (let i = 0; i < schemeCount; i++) {
    const label = (await schemeRuns.nth(i).textContent())?.trim();
    await schemeRuns.nth(i).click();
    await scan(page, `${theme} / ${label}`);
  }

  // ── The approximate-hint noise slider, at both ends ────────────────────
  for (const value of ['0', '20']) {
    await page.locator('#noise-slider').fill(value);
    await expect(page.locator('#noise-out, .readout-line').first()).toBeVisible();
    await scan(page, `${theme} / approximate hints at noise ${value}`);
  }

  // ── Every remaining disclosure, one at a time ──────────────────────────
  // Four of them, and NOT all in the same starting state: "The math behind the
  // curve" ships `open` while the other three ship closed. Toggling each in
  // turn scans the configuration a visitor actually arrives at plus its
  // opposite — which is what forcing them all open at once destroys.
  const others = page.locator('details:not(.hand-decode)');
  const otherCount = await others.count();
  expect(otherCount, 'every disclosure other than the hand-decode one').toBe(4);
  for (let i = 0; i < otherCount; i++) {
    const item = others.nth(i);
    const summary = (await item.locator('summary').textContent())?.trim();
    const startedOpen = (await item.getAttribute('open')) !== null;
    await item.locator('summary').click();
    if (startedOpen) {
      await expect(item).not.toHaveAttribute('open', '');
      await scan(page, `${theme} / disclosure collapsed: ${summary}`);
    } else {
      await expect(item).toHaveAttribute('open', '');
      await scan(page, `${theme} / disclosure open: ${summary}`);
    }
    await item.locator('summary').click();
  }
}
