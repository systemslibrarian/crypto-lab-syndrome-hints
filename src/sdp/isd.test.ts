import { describe, expect, it } from 'vitest';
import { matVec, weight } from './gf2';
import { makeInstance } from './instance';
import { reduceWithHints, runAttack } from './isd';
import type { PerfectHint } from './types';

/** Read the true error's support as a list of perfect (support-revealing) hints. */
function supportHints(e: Uint8Array): PerfectHint[] {
  const hints: PerfectHint[] = [];
  e.forEach((bit, index) => hints.push({ kind: 'perfect', index, value: bit as 0 | 1 }));
  return hints;
}

describe('ISD actually solves the real instance', () => {
  it('recovers a weight-w error with no hints, verified against H·e = s', () => {
    const inst = makeInstance({ n: 20, k: 10, w: 3, seed: 99 });
    const res = runAttack(inst, [], { seed: 1, maxIterations: 100_000 });
    expect(res.solved).toBe(true);
    expect(res.verified).toBe(true);
    expect(weight(res.recovered!)).toBeLessThanOrEqual(inst.w);
    expect(Array.from(matVec(inst.H, res.recovered!))).toEqual(Array.from(inst.s));
  });

  it('is a genuine search: harder (heavier) instances take more iterations', () => {
    const easy = makeInstance({ n: 24, k: 12, w: 2, seed: 3 });
    const hard = makeInstance({ n: 24, k: 12, w: 5, seed: 3 });
    const easyRuns = runAttack(easy, [], { seed: 5 });
    const hardRuns = runAttack(hard, [], { seed: 5 });
    expect(easyRuns.solved && hardRuns.solved).toBe(true);
    // Not a strict guarantee for a single seed, but overwhelmingly reliable:
    expect(hardRuns.iterations).toBeGreaterThanOrEqual(easyRuns.iterations);
  });
});

describe('perfect hints strictly shrink the instance and the work', () => {
  it('reduceWithHints subtracts revealed ones from s and drops their columns', () => {
    const inst = makeInstance({ n: 18, k: 9, w: 4, seed: 42 });
    const someHints = supportHints(inst.e).slice(0, 5); // first 5 coords revealed
    const red = reduceWithHints(inst, someHints);
    expect(red.n).toBe(inst.n - 5);
    // residual weight = w minus the revealed ONES among those 5 coords
    const revealedOnes = someHints.filter((h) => h.value === 1).length;
    expect(red.w).toBe(inst.w - revealedOnes);
  });

  it('revealing the full support collapses the search to 0 iterations (polynomial)', () => {
    const inst = makeInstance({ n: 22, k: 11, w: 4, seed: 8 });
    const full = supportHints(inst.e);
    const res = runAttack(inst, full, { seed: 0 });
    expect(res.solved).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.iterations).toBe(0); // nothing left to search
    expect(Array.from(res.recovered!)).toEqual(Array.from(inst.e));
  });

  it('more support hints lower the average iteration count', () => {
    const inst = makeInstance({ n: 24, k: 12, w: 5, seed: 21 });
    const ones = supportHints(inst.e).filter((h) => h.value === 1);
    // Average over many attack seeds so the trend is robust to the geometric
    // variance of a single randomized run.
    const avgIters = (hintCount: number) => {
      let total = 0;
      const trials = 60;
      for (let seed = 0; seed < trials; seed++) {
        total += runAttack(inst, ones.slice(0, hintCount), { seed }).iterations;
      }
      return total / trials;
    };
    // Compare well-separated endpoints: no hints vs all-but-one support one
    // (residual weight 1), which is near-instant — a reliably large gap.
    const none = avgIters(0);
    const almostAll = avgIters(ones.length - 1);
    expect(almostAll).toBeLessThan(none); // revealing support makes the search cheaper
  });
});
