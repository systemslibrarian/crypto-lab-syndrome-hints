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
// Applied to the real Level-1 parameter sets below, that bound does NOT
// separate the two schemes: mceliece348864 has t = 64 and hqc-128 has t = 66,
// so the model asks for two MORE hints against HQC, not fewer. Their relative
// weights differ sharply (t/n ≈ 1.8% vs 0.37%), but relative weight sets how
// hard the instance is with zero hints, not how many hints end it.
//
// The two toys below are therefore set at two visibly different weights (w = 6
// and w = 3) to make the weight→hints mechanism legible. Those toy weights are
// a teaching choice; they are not scaled from t = 64 and t = 66, and nothing
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
  /** Real decoding error weight t (fact). */
  realT: number;
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
    realT: 64,
    posture: 'resistant',
    blurb:
      'Real McEliece decodes a fixed-weight error of t = 64 in a length-3488 code (relative weight ≈ 1.8%). Its toy is set at the HEAVIER end of the mechanism (w = 6): a heavier error needs more support hints before its search collapses. That toy weight is a teaching choice, not a scaling of t = 64.',
    toy: { n: 22, k: 10, w: 6, seed: 0x11ce },
  },
  {
    id: 'hqc',
    name: 'HQC',
    realParams: 'hqc-128 (NIST Level 1)',
    sourceUrl: 'https://pqc-hqc.org/',
    realN: 17_669,
    realT: 66,
    posture: 'fragile',
    blurb:
      'Real HQC decodes t = 66 errors in a length-17669 code — almost the same ABSOLUTE weight as McEliece, in a code five times longer (relative weight ≈ 0.37%). Its toy is set at the LIGHTER end of the mechanism (w = 3): a lighter error reaches polynomial time after fewer support hints. That toy weight is a teaching choice, not a scaling of t = 66.',
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
 * `realT` — there the bound gives 64 vs 66 and separates nothing.
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
