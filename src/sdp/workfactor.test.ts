import { describe, expect, it } from 'vitest';
import {
  approxGainBits,
  bestSternParams,
  hintsToPolynomial,
  log2Binom,
  prangeWorkBits,
  searchExponentBits,
  sternWorkBits,
  workCurve,
} from './workfactor';
import { schemeContrast } from './schemes';

describe('log2Binom', () => {
  it('matches exact small binomials', () => {
    expect(log2Binom(4, 2)).toBeCloseTo(Math.log2(6), 6); // C(4,2)=6
    expect(log2Binom(10, 3)).toBeCloseTo(Math.log2(120), 4); // C(10,3)=120
  });
  it('is 0 at the endpoints and -Infinity out of range', () => {
    expect(log2Binom(9, 0)).toBe(0);
    expect(log2Binom(9, 9)).toBe(0);
    expect(log2Binom(5, 6)).toBe(-Infinity);
  });
});

describe('work-factor curve slides exponential -> polynomial', () => {
  it('search exponent is large at full weight and 0 once the support is known', () => {
    const full = searchExponentBits({ n: 40, r: 20, w: 6 });
    const none = searchExponentBits({ n: 40, r: 20, w: 0 });
    expect(full).toBeGreaterThan(5); // C(40,6)/C(20,6) ≈ 2^6.6
    expect(full).toBeGreaterThan(none);
    expect(none).toBe(0);
  });

  it('is monotonically non-increasing in the hint count', () => {
    const pts = workCurve({ n: 40, r: 20, w: 6 });
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].bits).toBeLessThanOrEqual(pts[i - 1].bits + 1e-9);
    }
  });

  it('reaches the polynomial floor exactly when w hints are applied', () => {
    const pts = workCurve({ n: 40, r: 20, w: 6 });
    expect(pts[0].polynomial).toBe(false);
    const last = pts[pts.length - 1];
    expect(last.hints).toBe(6);
    expect(last.w).toBe(0);
    expect(last.polynomial).toBe(true);
  });

  it('hintsToPolynomial equals the error weight (the explicit bound)', () => {
    expect(hintsToPolynomial(6)).toBe(6);
    expect(hintsToPolynomial(3)).toBe(3);
  });
});

describe('approximate-hint information model', () => {
  it('a perfect meter over b coords is worth log2(b+1) bits', () => {
    expect(approxGainBits(7, 0)).toBeCloseTo(Math.log2(8), 6);
  });
  it('noise erases gain and never goes negative', () => {
    expect(approxGainBits(7, 3)).toBeCloseTo(Math.log2(8) - 3, 6);
    expect(approxGainBits(7, 99)).toBe(0);
  });
});

describe('Stern work model beats Prange on the toy instance', () => {
  const inp = { n: 48, r: 24, w: 10 };
  it('picks a real birthday split (p ≥ 1)', () => {
    expect(bestSternParams(inp).p).toBeGreaterThanOrEqual(1);
  });
  it('models a strictly lower total work than Prange', () => {
    expect(sternWorkBits(inp)).toBeLessThan(prangeWorkBits(inp));
  });
  it('both collapse to the polynomial floor once the support is known', () => {
    const floor = { n: 38, r: 24, w: 0 };
    expect(sternWorkBits(floor)).toBeCloseTo(prangeWorkBits(floor), 6);
  });

  it('Stern is never worse than Prange, and its curve is monotone in hints', () => {
    let prev = Infinity;
    for (let h = 0; h <= 10; h++) {
      const inp = { n: 48 - h, r: 24, w: 10 - h };
      const s = sternWorkBits(inp);
      expect(s).toBeLessThanOrEqual(prangeWorkBits(inp) + 1e-9); // never worse than the fallback
      expect(s).toBeLessThanOrEqual(prev + 1e-9); // more hints never raise the work
      prev = s;
    }
  });
});

describe('McEliece vs HQC error-weight finding', () => {
  it('the low-weight scheme (HQC) needs fewer hints to reach poly time', () => {
    const c = schemeContrast();
    const hqc = c.find((s) => s.id === 'hqc')!;
    const mce = c.find((s) => s.id === 'mceliece')!;
    expect(hqc.posture).toBe('fragile');
    expect(mce.posture).toBe('resistant');
    expect(hqc.hintsToPoly).toBeLessThan(mce.hintsToPoly);
  });
});
