import { describe, expect, it } from 'vitest';
import { matVec, weight } from './gf2';
import { HAMMING_7_4_H, makeInstance } from './instance';

/**
 * Known-answer tests for the [7,4] Hamming code. With columns ordered so that
 * column j (1-indexed) is the binary value j, a single-bit error at position j
 * has syndrome exactly binary(j). This is the textbook single-error-correcting
 * property and pins our GF(2) matVec to a spec constant, not to itself.
 */
describe('Hamming [7,4] syndrome KATs', () => {
  const syndromeValue = (s: Uint8Array) => s[0] * 4 + s[1] * 2 + s[2] * 1;

  for (let j = 1; j <= 7; j++) {
    it(`single-bit error at position ${j} has syndrome = binary(${j})`, () => {
      const e = new Uint8Array(7);
      e[j - 1] = 1; // 0-based index j-1 is the column whose value is j
      const s = matVec(HAMMING_7_4_H, e);
      expect(syndromeValue(s)).toBe(j);
    });
  }

  it('the zero error has the zero syndrome', () => {
    expect(syndromeValue(matVec(HAMMING_7_4_H, new Uint8Array(7)))).toBe(0);
  });

  it('two single-error syndromes XOR to the double-error syndrome', () => {
    const e = new Uint8Array(7);
    e[0] = 1; // value 1
    e[2] = 1; // value 3
    // syndrome should be binary(1) XOR binary(3) = 001 ^ 011 = 010 = 2
    expect(syndromeValue(matVec(HAMMING_7_4_H, e))).toBe(2);
  });
});

describe('random SDP instance', () => {
  it('is well-formed: s = H·e and weight(e) = w, reproducibly', () => {
    const inst = makeInstance({ n: 24, k: 12, w: 4, seed: 12345 });
    expect(inst.r).toBe(12);
    expect(weight(inst.e)).toBe(4);
    expect(Array.from(matVec(inst.H, inst.e))).toEqual(Array.from(inst.s));
  });

  it('is deterministic in the seed', () => {
    const a = makeInstance({ n: 20, k: 10, w: 3, seed: 7 });
    const b = makeInstance({ n: 20, k: 10, w: 3, seed: 7 });
    expect(Array.from(a.e)).toEqual(Array.from(b.e));
    expect(a.H.map((r) => Array.from(r))).toEqual(b.H.map((r) => Array.from(r)));
  });
});
