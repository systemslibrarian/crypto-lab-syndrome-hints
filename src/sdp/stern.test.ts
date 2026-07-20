import { describe, expect, it } from 'vitest';
import { matVec, weight } from './gf2';
import { HAMMING_7_4_H, makeInstance } from './instance';
import { runStern } from './stern';
import { runAttack } from './isd';
import type { Instance, PerfectHint } from './types';

function supportHints(e: Uint8Array): PerfectHint[] {
  return Array.from(e).flatMap((b, index) => (b ? [{ kind: 'perfect' as const, index, value: 1 as const }] : []));
}

describe('Stern actually recovers the error on the real instance', () => {
  it('solves the sized-up toy instance, verified against H·e = s', () => {
    const inst = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
    const res = runStern(inst, [], { seed: 3 });
    expect(res.solved).toBe(true);
    expect(res.verified).toBe(true);
    expect(weight(res.recovered!)).toBeLessThanOrEqual(inst.w);
    expect(Array.from(matVec(inst.H, res.recovered!))).toEqual(Array.from(inst.s));
  });

  it('runs a genuine birthday search (p ≥ 1), not a degenerate single test', () => {
    const inst = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
    const res = runStern(inst, [], { seed: 3 });
    expect(res.params.p).toBeGreaterThanOrEqual(1);
    expect(res.params.l).toBeGreaterThanOrEqual(1);
  });

  it('forces a p = 1 collision search on a smaller instance and still recovers e', () => {
    const inst = makeInstance({ n: 30, k: 15, w: 4, seed: 77 });
    const res = runStern(inst, [], { seed: 9 });
    expect(res.solved && res.verified).toBe(true);
    expect(res.params.p).toBeGreaterThanOrEqual(1);
    expect(Array.from(matVec(inst.H, res.recovered!))).toEqual(Array.from(inst.s));
  });
});

describe('Stern is genuinely cheaper than Prange on the same instance', () => {
  it('reports a lower total work factor (the whole point of Stern)', () => {
    const inst = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
    const avg = (fn: (seed: number) => number) => {
      let t = 0;
      for (let s = 0; s < 4; s++) t += fn(s + 1);
      return t / 4;
    };
    const sternWork = avg((seed) => runStern(inst, [], { seed }).work);
    const prangeWork = avg((seed) => runAttack(inst, [], { seed }).work);
    expect(sternWork).toBeLessThan(prangeWork);
  });
});

describe('Stern uses the SAME Hint-ISD reduction as Prange', () => {
  it('perfect hints shrink the instance; revealing the full support is instant', () => {
    const inst = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
    const full = supportHints(inst.e);
    const res = runStern(inst, full, { seed: 1 });
    expect(res.solved && res.verified).toBe(true);
    expect(res.iterations).toBe(0); // nothing left to search
    expect(Array.from(res.recovered!)).toEqual(Array.from(inst.e));
  });

  it('a few support hints still solve and verify', () => {
    const inst = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
    const res = runStern(inst, supportHints(inst.e).slice(0, 4), { seed: 2 });
    expect(res.solved && res.verified).toBe(true);
    expect(Array.from(matVec(inst.H, res.recovered!))).toEqual(Array.from(inst.s));
  });
});

// Reference/spec KATs: Stern must decode the classic [7,4] Hamming code. Each
// single-bit error is the canonical minimum-weight solution for its syndrome.
describe('Stern decodes the [7,4] Hamming code — spec KATs', () => {
  for (let j = 1; j <= 7; j++) {
    it(`recovers the single-bit error at position ${j}`, () => {
      const e = new Uint8Array(7);
      e[j - 1] = 1;
      const s = matVec(HAMMING_7_4_H, e);
      const inst: Instance = { n: 7, k: 4, r: 3, w: 1, H: HAMMING_7_4_H, e, s };
      const res = runStern(inst, [], { seed: j });
      expect(res.solved && res.verified).toBe(true);
      expect(Array.from(res.recovered!)).toEqual(Array.from(e));
    });
  }
});
