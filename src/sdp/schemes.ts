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
    realN: 3488,
    realT: 64,
    posture: 'resistant',
    blurb:
      'Decodes a high-weight error (t = 64 flips in a length-3488 code). The support is a large set, so a few leaked coordinates remove only a small fraction of the search — hints erode security slowly.',
    toy: { n: 22, k: 10, w: 6, seed: 0x11ce },
  },
  {
    id: 'hqc',
    name: 'HQC',
    realParams: 'hqc-128 (NIST Level 1)',
    realN: 17_669,
    realT: 66,
    posture: 'fragile',
    blurb:
      'Decodes a low-weight error relative to its long length. Its support is a tiny fraction of the codeword, so each leaked coordinate is a big share of the whole secret — few hints push it toward polynomial time.',
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
