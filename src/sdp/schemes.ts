// ---------------------------------------------------------------------------
// McEliece vs HQC — the error-weight mechanism, made concrete, and honest about
// what it does and does not separate.
//
// This demo's fragility bound is `hintsToPolynomial(w) = w`: reveal the whole
// support and nothing is left to search. The bound is a function of the
// ABSOLUTE error weight alone — the code length n never enters it. So in this
// model "hint-fragile" means exactly "small t", and a lighter error reaches
// polynomial time after fewer support hints than a heavier one.
//
// Quoted Level-1 weights do NOT validate a real-scheme comparison under this
// toy bound: mceliece348864 injects an error of weight t = 64, while HQC-1's
// sparse private vectors x and y each have weight ω = 67 (2026-10-12 spec).
// Applying hintsToPolynomial numerically gives 64 vs 67, but the weights have
// different roles and the actual HQC decoding noise is x·r2 - r1·y + e.
//
// The two toys below are therefore set at two visibly different weights (w = 6
// and w = 3) to make the weight→hints mechanism legible. Those toy weights are
// a teaching choice; they are not scaled from the quoted 64 and 67, and nothing
// about which scheme resists hint exposure in practice follows from them.
// Hint-ISD (ePrint 2026/341) does conclude that higher-weight schemes such as
// McEliece resist hint exposure better than smaller-weight ones such as HQC,
// but that conclusion comes from its full estimator, which this browser demo
// does not reproduce.
//
// The large real-parameter numbers below are reported as sourced FACTS on the
// real schemes; the demo actually *runs* only the toy instances (browser-scale).
// ---------------------------------------------------------------------------

import { hintsToPolynomial } from './workfactor';

export interface SchemeFacts {
  id: 'mceliece' | 'hqc';
  name: string;
  /** Real Level-1 parameter set this scheme is contextualised against. */
  realParams: string;
  /** Primary source for the real parameters. */
  sourceUrl: string;
  /** Real code length n (fact, not run in-browser). */
  realN: number;
  /** A quoted sparse-vector weight from each distinct scheme, not a common attack parameter. */
  realWeight: number;
  /**
   * Which end of the TOY hint axis this scheme's toy sits at. A property of the
   * toy, not a ranking of the real schemes — see the header comment.
   */
  posture: 'resistant' | 'fragile';
  blurb: string;
  /**
   * Browser-scale toy instance, set at a deliberately light or heavy weight so
   * the live ISD run makes the weight→hints mechanism visible. Not a scaling of
   * the real parameters.
   */
  toy: { n: number; k: number; w: number; seed: number };
}

export const SCHEMES: SchemeFacts[] = [
  {
    id: 'mceliece',
    name: 'Classic McEliece',
    realParams: 'mceliece348864 (NIST Level 1)',
    sourceUrl: 'https://classic.mceliece.org/',
    realN: 3488,
    realWeight: 64,
    posture: 'resistant',
    blurb:
      'Real McEliece decodes a fixed-weight error of t = 64 in a length-3488 code (relative weight ≈ 1.8%). Its toy is set at the HEAVIER end of the mechanism (w = 6): a heavier error needs more support hints before its search collapses. That toy weight is a teaching choice, not a scaling of t = 64.',
    toy: { n: 22, k: 10, w: 6, seed: 0x11ce },
  },
  {
    id: 'hqc',
    name: 'HQC',
    realParams: 'HQC-1 (NIST Level 1)',
    sourceUrl: 'https://pqc-hqc.org/doc/hqc_specifications_2026_10_12.pdf',
    realN: 17_669,
    realWeight: 67,
    posture: 'fragile',
    blurb:
      'HQC-1’s 12 October 2026 specification sets each sparse secret vector x and y to weight ω = 67 in dimension n = 17,669 (ω/n ≈ 0.38%). This is not the decoder’s error-correction radius: the noise being decoded includes x·r2 − r1·y + e. Its lighter toy (w = 3) illustrates the generic support-hint mechanism, not a scaled HQC attack or an HQC security estimate.',
    toy: { n: 26, k: 18, w: 3, seed: 0x4c },
  },
];

export interface SchemeContrast {
  id: string;
  name: string;
  posture: string;
  toyW: number;
  /** Perfect (support) hints to reach polynomial time on the toy instance. */
  hintsToPoly: number;
}

/**
 * The comparison the panel renders, computed on the TOY weights: fewer
 * hints-to-poly ⇒ the toy collapses sooner. Deliberately not computed on
 * the quoted real weights — 64 and 67 play different roles in these schemes.
 */
export function schemeContrast(): SchemeContrast[] {
  return SCHEMES.map((s) => ({
    id: s.id,
    name: s.name,
    posture: s.posture,
    toyW: s.toy.w,
    hintsToPoly: hintsToPolynomial(s.toy.w),
  }));
}
