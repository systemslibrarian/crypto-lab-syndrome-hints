import { describe, expect, it } from 'vitest';
import { column, matVec, weight, type Mat, type Vec } from './gf2';
import { makeInstance } from './instance';
import { reduceWithHints, reconstruct, runAttack } from './isd';
import { runStern } from './stern';
import { prangeWorkBits, sternWorkBits } from './workfactor';
import type { Instance, PerfectHint } from './types';

function supportHints(e: Vec): PerfectHint[] {
  return Array.from(e).flatMap((b, index) => (b ? [{ kind: 'perfect' as const, index, value: 1 as const }] : []));
}

/** Exhaustive minimum-weight decode by brute force — the ground truth oracle. */
function bruteForceMinWeight(inst: Instance): { minWeight: number; solutions: number } {
  let minWeight = Infinity;
  let solutions = 0;
  const e = new Uint8Array(inst.n);
  const rec = (idx: number, w: number) => {
    if (w > minWeight) return;
    if (idx === inst.n) {
      const s = matVec(inst.H, e);
      if (s.every((b, i) => b === inst.s[i])) {
        if (w < minWeight) {
          minWeight = w;
          solutions = 1;
        } else if (w === minWeight) solutions++;
      }
      return;
    }
    e[idx] = 0;
    rec(idx + 1, w);
    e[idx] = 1;
    rec(idx + 1, w + 1);
    e[idx] = 0;
  };
  rec(0, 0);
  return { minWeight, solutions };
}

describe('solvers cross-checked against exhaustive ground truth (tiny instances)', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`n=16, seed ${seed}: both return a valid solution no lighter than the true minimum`, () => {
      const inst = makeInstance({ n: 16, k: 8, w: 3, seed });
      const truth = bruteForceMinWeight(inst);
      expect(truth.minWeight).toBeLessThanOrEqual(inst.w);

      // ISD with a weight bound is a *bounded-weight* decoder: it must return a
      // valid weight-≤w solution, and — checked against exhaustive search — it can
      // never return one lighter than the genuine minimum weight of the coset.
      for (const run of [runAttack(inst, [], { seed: 9 }), runStern(inst, [], { seed: 9 })]) {
        expect(run.solved && run.verified).toBe(true);
        expect(Array.from(matVec(inst.H, run.recovered!))).toEqual(Array.from(inst.s));
        const wt = weight(run.recovered!);
        expect(wt).toBeGreaterThanOrEqual(truth.minWeight);
        expect(wt).toBeLessThanOrEqual(inst.w);
      }
    });
  }
});

describe('reduction / reconstruction is an exact round-trip', () => {
  it('reduceWithHints + reconstruct rebuilds the true error for any support subset', () => {
    const inst = makeInstance({ n: 30, k: 15, w: 5, seed: 55 });
    const support = Array.from(inst.e).flatMap((b, i) => (b ? [i] : []));
    for (let k = 0; k <= support.length; k++) {
      const hints = support.slice(0, k).map((index) => ({ kind: 'perfect' as const, index, value: 1 as const }));
      const red = reduceWithHints(inst, hints);
      // The residual error is the true error restricted to the surviving columns.
      const residual = new Uint8Array(red.n);
      red.colMap.forEach((orig, i) => (residual[i] = inst.e[orig]));
      const rebuilt = reconstruct(inst.n, residual, red);
      expect(Array.from(rebuilt)).toEqual(Array.from(inst.e));
      // And the reduced syndrome is consistent: H_red · residual = s_red.
      expect(Array.from(matVec(red.H, residual))).toEqual(Array.from(red.s));
    }
  });
});

describe('hints are handled fail-closed, never fabricating a false success', () => {
  it('a contradictory hint (wrong value) never yields solved-but-unverified', () => {
    const inst = makeInstance({ n: 22, k: 11, w: 4, seed: 3 });
    // Claim a zero coordinate is a 1 — a lie the attacker might feed in.
    const zeroIdx = Array.from(inst.e).findIndex((b) => b === 0);
    const badHints: PerfectHint[] = [{ kind: 'perfect', index: zeroIdx, value: 1 }];
    for (const run of [runAttack(inst, badHints, { seed: 1, maxIterations: 20000 }), runStern(inst, badHints, { seed: 1, maxIterations: 4000 })]) {
      // Whatever it returns, "solved" must imply a real verified solution of the
      // ORIGINAL instance — the solver may find a different low-weight e or fail,
      // but it must never claim success without H·e = s.
      if (run.solved) {
        expect(run.verified).toBe(true);
        expect(Array.from(matVec(inst.H, run.recovered!))).toEqual(Array.from(inst.s));
        expect(weight(run.recovered!)).toBeLessThanOrEqual(inst.w);
      } else {
        expect(run.recovered).toBeNull();
      }
    }
  });

  it('does not crash on a full-support hint set, and returns e exactly', () => {
    const inst = makeInstance({ n: 20, k: 10, w: 4, seed: 6 });
    for (const run of [runAttack(inst, supportHints(inst.e)), runStern(inst, supportHints(inst.e))]) {
      expect(run.solved && run.verified).toBe(true);
      expect(Array.from(run.recovered!)).toEqual(Array.from(inst.e));
    }
  });
});

describe('the syndrome really is a linear map (structural KAT)', () => {
  it('H·(a⊕b) = H·a ⊕ H·b for random vectors', () => {
    const inst = makeInstance({ n: 24, k: 12, w: 4, seed: 2 });
    const rand = (seed: number): Vec => {
      const v = new Uint8Array(inst.n);
      let x = seed >>> 0;
      for (let i = 0; i < inst.n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        v[i] = (x >> 8) & 1;
      }
      return v;
    };
    const a = rand(11);
    const b = rand(22);
    const ab = new Uint8Array(inst.n);
    for (let i = 0; i < inst.n; i++) ab[i] = a[i] ^ b[i];
    const lhs = matVec(inst.H, ab);
    const rhs = matVec(inst.H, a).map((x, i) => x ^ matVec(inst.H, b)[i]);
    expect(Array.from(lhs)).toEqual(Array.from(rhs));
  });

  it('a single column of H is the syndrome of a single-bit error', () => {
    const inst = makeInstance({ n: 18, k: 9, w: 3, seed: 1 });
    for (let j = 0; j < inst.n; j++) {
      const e = new Uint8Array(inst.n);
      e[j] = 1;
      expect(Array.from(matVec(inst.H, e))).toEqual(Array.from(column(inst.H as Mat, j)));
    }
  });
});

describe('model calibration: measured medians track the modelled curves', () => {
  // Over a grid of Gilbert–Varshamov-bound instances (near-unique low-weight
  // solution, so the unique-solution model is valid), the median measured work
  // of many genuine runs sits within a declared tolerance of the model. This is
  // what backs the demo's claim that the plotted dots "land near" their curves.
  // Prange tracks tightly (≈ ±1.5 bits); Stern's model is a mild CONSERVATIVE
  // over-estimate (measured sits up to ~2.5 bits below), hence the 3-bit bound.
  const grid: [number, number, number][] = [
    [64, 24, 11], // the demo's MAIN instance
    [48, 20, 7],
    [40, 16, 6],
    [44, 18, 7],
  ];
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const TOL = 3.0; // bits — bounds the predicted/observed gap on a ~19-bit scale

  for (const [n, k, w] of grid) {
    it(`n=${n}, w=${w}: Prange & Stern medians within ${TOL} bits of the model`, () => {
      const inst = makeInstance({ n, k, w, seed: 0xa11 });
      const inp = { n, r: n - k, w };
      const prangeMed = Math.log2(
        Math.max(1, median(Array.from({ length: 31 }, (_, s) => runAttack(inst, [], { seed: s + 1 }).work))),
      );
      const sternMed = Math.log2(
        Math.max(1, median(Array.from({ length: 31 }, (_, s) => runStern(inst, [], { seed: s + 1 }).work))),
      );
      // Prange is the tight one — assert it stays within 2 bits.
      expect(Math.abs(prangeMed - prangeWorkBits(inp))).toBeLessThan(2.0);
      // Stern's model is conservative; measured must be at or below it, within TOL.
      expect(sternMed).toBeLessThan(sternWorkBits(inp) + 0.5);
      expect(sternWorkBits(inp) - sternMed).toBeLessThan(TOL);
    });
  }
});
