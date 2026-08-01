import type { Mat, Vec } from './gf2';

/** A concrete syndrome-decoding instance: find low-weight e with H·e = s. */
export interface Instance {
  /** Code length (columns of H, length of e). */
  n: number;
  /** Code dimension; redundancy r = n − k is the number of rows of H. */
  k: number;
  /** Redundancy = number of parity-check rows = length of s. */
  r: number;
  /** Planted error weight (the low-weight target the attacker must find). */
  w: number;
  /** Parity-check matrix, r × n over GF(2). Public in every code-based scheme. */
  H: Mat;
  /** The (secret) planted error vector, length n, weight w. */
  e: Vec;
  /** Syndrome s = H·e, length r. This is what the attacker is handed. */
  s: Vec;
}

/**
 * The two hint kinds this demo implements. BOTH come from Information-Set
 * Decoding with Hints (Horlemann, Puchinger, Renner, Schamberger, Wachter-Zeh,
 * ePrint 2021/279):
 *  - 'perfect'     — a leak of the exact value of one error coordinate: that
 *                    paper's "known error locations" hint. We *run* the real ISD
 *                    with these applied, so this path is exact, not modelled.
 *  - 'approximate' — a side channel leaks a noisy Hamming-weight estimate over a
 *                    block of coordinates: that paper's known-subblock-weight
 *                    hint. Recast as soft-decision info; its saving is *modelled*.
 *
 * A DIFFERENT hint channel exists and is deliberately not implemented here: the
 * Cayrel et al. (Eurocrypt '21) fault attack suppresses the modular reduction so
 * the attacker reads SYNDROME entries over the integers. Hint-ISD (ePrint
 * 2026/341) calls those "perfect hints" too, but they reveal syndrome
 * components, not error positions. See METHODOLOGY.md.
 */
export type HintKind = 'perfect' | 'approximate';

export interface PerfectHint {
  kind: 'perfect';
  /** Which error coordinate this hint leaked. */
  index: number;
  /** Its exact value, 0 or 1. */
  value: 0 | 1;
}

export interface ApproximateHint {
  kind: 'approximate';
  /** Coordinates covered by this weight measurement. */
  block: number[];
  /** The true weight over `block` (what a perfect meter would read). */
  trueWeight: number;
  /** Bits of uncertainty the noisy meter still leaves (0 = perfect meter). */
  noiseBits: number;
}

export type Hint = PerfectHint | ApproximateHint;

/** Result of running the real ISD attack on an instance (+ any perfect hints). */
export interface AttackResult {
  /** Whether a weight ≤ w solution was found within the iteration cap. */
  solved: boolean;
  /** The recovered error vector (verified: H·recovered = s). */
  recovered: Vec | null;
  /** Iterations the randomized search actually took. This is measured work. */
  iterations: number;
  /**
   * Elementary operations the run actually performed (GF(2) row-combines plus
   * candidate tests, and for Stern collision-list entries) — the shared ledger
   * unit, so the two algorithms' costs sit on one comparable axis.
   */
  work: number;
  /** True once we checked H·recovered = s and weight ≤ w. */
  verified: boolean;
  /** Residual instance the perfect hints reduced the problem to. */
  reduced: { n: number; r: number; w: number };
}
