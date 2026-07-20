// ---------------------------------------------------------------------------
// McEliece vs HQC — the paper's error-weight finding, made concrete.
//
// Both are code-based and both rest on syndrome decoding, but they sit at
// opposite ends of the error-weight axis:
//   - Classic McEliece decodes a HIGH-weight error (t large). Its support is a
//     big fraction of the codeword, so leaking a few coordinates barely dents
//     the search — it *resists* hints.
//   - HQC decodes a LOW-weight error (t small relative to n). Its support is
//     tiny, so a handful of leaked coordinates is a large fraction of the whole
//     secret — it is *fragile* to hints.
//
// The `hintsToPolynomial` count (= w) is the crisp version of that contrast.
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
  /** Real decoding error weight t (fact). Drives the fragility contrast. */
  realT: number;
  /** One-line characterisation of its hint resistance. */
  posture: 'resistant' | 'fragile';
  blurb: string;
  /**
   * Browser-scale toy instance that shares the scheme's *shape* (high vs low
   * weight relative to n) so the live ISD run reproduces the contrast honestly.
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
      'Real McEliece decodes a fixed-weight error of t = 64 in a length-3488 code (relative weight ≈ 1.8%). This toy stands in for the HIGHER-weight end of the mechanism (w = 6): a heavier error needs more support hints before its search collapses.',
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
      'Real HQC decodes a low-weight error (t = 66 in a length-17669 code, relative weight ≈ 0.37%). This toy stands in for the LOWER-weight end of the mechanism (w = 3): a lighter error reaches polynomial time after fewer support hints.',
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

/** The comparison the panel renders: fewer hints-to-poly ⇒ more fragile. */
export function schemeContrast(): SchemeContrast[] {
  return SCHEMES.map((s) => ({
    id: s.id,
    name: s.name,
    posture: s.posture,
    toyW: s.toy.w,
    hintsToPoly: hintsToPolynomial(s.toy.w),
  }));
}
