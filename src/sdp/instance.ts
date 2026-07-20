// ---------------------------------------------------------------------------
// Building a *real* syndrome-decoding instance over F_2.
//
// We generate a random parity-check matrix H (r × n), plant a genuine
// low-weight error e (weight exactly w), and compute the syndrome s = H·e.
// Nothing is faked: the attack modules below actually recover e from (H, s)
// with no knowledge of the plant. Sizes are deliberately small so the browser
// can run the search live, but the object is an honest SDP instance.
// ---------------------------------------------------------------------------

import { matVec, weight, type Mat } from './gf2';
import { mulberry32, sample, type Rng } from './rng';
import type { Instance } from './types';

/**
 * The classic [7,4] Hamming code parity-check matrix, columns ordered so that
 * column j (1-indexed) is the binary representation of j. This gives the
 * textbook property used as a known-answer test: a single-bit error at
 * position j has syndrome = binary(j). See sdp/*.test.ts.
 */
export const HAMMING_7_4_H: Mat = [
  // rows are the 3 parity checks; column j below is binary(j) top-to-bottom
  Uint8Array.from([0, 0, 0, 1, 1, 1, 1]), // bit value 4
  Uint8Array.from([0, 1, 1, 0, 0, 1, 1]), // bit value 2
  Uint8Array.from([1, 0, 1, 0, 1, 0, 1]), // bit value 1
];

function randomMatrix(rng: Rng, r: number, n: number): Mat {
  const H: Mat = [];
  for (let i = 0; i < r; i++) {
    const row = new Uint8Array(n);
    for (let j = 0; j < n; j++) row[j] = rng() < 0.5 ? 1 : 0;
    H.push(row);
  }
  return H;
}

export interface InstanceParams {
  n: number;
  k: number;
  w: number;
  seed: number;
}

/**
 * Generate a fresh instance. The error support is a random weight-w subset of
 * the n positions; H is a uniform random r × n binary matrix. Deterministic in
 * `seed`, so the same seed always reproduces the same H, e and s.
 */
export function makeInstance(params: InstanceParams): Instance {
  const { n, k, w, seed } = params;
  const r = n - k;
  const rng = mulberry32(seed);
  const H = randomMatrix(rng, r, n);

  const support = sample(rng, n, w);
  const e = new Uint8Array(n);
  for (const idx of support) e[idx] = 1;

  const s = matVec(H, e);
  // Invariant the whole demo rests on: the syndrome really is H·e, and the
  // planted error really has the claimed weight.
  if (weight(e) !== w) throw new Error('instance: planted weight mismatch');

  return { n, k, r, w, H, e, s };
}
