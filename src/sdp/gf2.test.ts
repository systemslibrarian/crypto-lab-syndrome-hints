import { describe, expect, it } from 'vitest';
import { column, equal, matVec, solveSquare, weight, xor, type Mat } from './gf2';

describe('GF(2) primitives', () => {
  it('weight counts ones', () => {
    expect(weight(Uint8Array.from([1, 0, 1, 1, 0]))).toBe(3);
    expect(weight(Uint8Array.from([0, 0, 0]))).toBe(0);
  });

  it('xor is GF(2) addition (self-inverse)', () => {
    const a = Uint8Array.from([1, 0, 1, 1]);
    const b = Uint8Array.from([1, 1, 1, 0]);
    expect(Array.from(xor(a, b))).toEqual([0, 1, 0, 1]);
    expect(equal(xor(xor(a, b), b), a)).toBe(true); // a ^ b ^ b = a
  });

  it('matVec computes each syndrome bit as a parity (XOR) of covered errors', () => {
    const H: Mat = [Uint8Array.from([1, 1, 0]), Uint8Array.from([0, 1, 1])];
    // e = [1,1,0] -> row0: 1^1=0, row1: 1^0=1
    expect(Array.from(matVec(H, Uint8Array.from([1, 1, 0])))).toEqual([0, 1]);
  });

  it('column extracts a column as a vector', () => {
    const H: Mat = [Uint8Array.from([1, 0]), Uint8Array.from([1, 1])];
    expect(Array.from(column(H, 0))).toEqual([1, 1]);
    expect(Array.from(column(H, 1))).toEqual([0, 1]);
  });

  it('solveSquare inverts an invertible GF(2) system and reports singular ones', () => {
    // M = I3 -> x = b
    const I: Mat = [
      Uint8Array.from([1, 0, 0]),
      Uint8Array.from([0, 1, 0]),
      Uint8Array.from([0, 0, 1]),
    ];
    const b = Uint8Array.from([1, 0, 1]);
    expect(Array.from(solveSquare(I, b)!)).toEqual([1, 0, 1]);

    // Round-trip on a random-looking invertible matrix.
    const M: Mat = [
      Uint8Array.from([1, 1, 0]),
      Uint8Array.from([0, 1, 1]),
      Uint8Array.from([1, 0, 1]),
    ];
    // This M is actually singular over GF(2) (row0^row1^row2 = 0): expect null.
    expect(solveSquare(M, b)).toBeNull();

    const M2: Mat = [
      Uint8Array.from([1, 1, 0]),
      Uint8Array.from([0, 1, 1]),
      Uint8Array.from([0, 0, 1]),
    ];
    const x = solveSquare(M2, b)!;
    expect(Array.from(matVec(M2, x))).toEqual(Array.from(b)); // M2·x = b
  });
});
