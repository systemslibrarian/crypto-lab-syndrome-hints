// ---------------------------------------------------------------------------
// Information-Set Decoding — the real attack, actually executed.
//
// This is a genuine Prange-style ISD: given (H, s) with NO knowledge of the
// planted error, it randomly guesses which r columns carry the error, inverts
// that r×r submatrix over GF(2), and checks whether the resulting candidate has
// weight ≤ w. It loops until it lands a hit, counting iterations. The count it
// returns is measured work, not a formula — and `runAttack` verifies H·e = s on
// the ORIGINAL instance before declaring success.
//
// Prange is the baseline of the ISD family (Stern, MMT, BJMM refine the
// mid-step); the baseline is enough to *show* the exponential→polynomial slide
// as hints shrink the instance, and it's small enough to run live.
// ---------------------------------------------------------------------------

import { column, matVec, solveSquare, weight, type Mat, type OpCounter, type Vec } from './gf2';
import { mulberry32, sample, type Rng } from './rng';
import type { AttackResult, Instance, PerfectHint } from './types';

export interface AttackOptions {
  /** Seed for the randomized column guessing (reproducible runs). */
  seed?: number;
  /** Hard cap on iterations so a hard instance can't hang the browser. */
  maxIterations?: number;
}

export interface Reduced {
  H: Mat;
  s: Vec;
  r: number;
  n: number;
  w: number;
  /** reduced column index → original column index in the full instance. */
  colMap: number[];
  /** original indices the hints already fixed to 1 (part of the final e). */
  fixedOnes: number[];
}

/**
 * Fold perfect hints (exact leaked error coordinates) into a smaller instance.
 * A hint e_i = 1 is subtracted from the syndrome (s ^= column i) and its column
 * dropped; a hint e_i = 0 just drops the column. Both shrink n; a revealed 1
 * also shrinks the residual weight w. This is exactly why perfect hints help:
 * the leftover problem is a *strictly smaller* SDP instance.
 */
export function reduceWithHints(inst: Instance, hints: PerfectHint[]): Reduced {
  const fixed = new Map<number, 0 | 1>();
  for (const h of hints) fixed.set(h.index, h.value);

  let s: Vec = inst.s.slice();
  const fixedOnes: number[] = [];
  for (const [idx, val] of fixed) {
    if (val === 1) {
      s = xorInto(s, column(inst.H, idx));
      fixedOnes.push(idx);
    }
  }

  const colMap: number[] = [];
  for (let j = 0; j < inst.n; j++) if (!fixed.has(j)) colMap.push(j);

  const H: Mat = inst.H.map((row) => {
    const nr = new Uint8Array(colMap.length);
    colMap.forEach((orig, newIdx) => (nr[newIdx] = row[orig]));
    return nr;
  });

  return {
    H,
    s,
    r: inst.r,
    n: colMap.length,
    w: inst.w - fixedOnes.length,
    colMap,
    fixedOnes,
  };
}

function xorInto(a: Vec, b: Vec): Vec {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ^ b[i]) & 1;
  return out;
}

/** One Prange trial on a reduced problem. Returns the residual e or null. */
function prangeOnce(
  H: Mat,
  s: Vec,
  r: number,
  n: number,
  w: number,
  rng: Rng,
  counter: OpCounter,
): Vec | null {
  // Guess that the error is confined to r of the n columns; if r > n the
  // system is over-determined and we take all columns.
  const pick = sample(rng, n, Math.min(r, n));
  const square: Mat = H.map((row) => {
    const sq = new Uint8Array(pick.length);
    pick.forEach((col, i) => (sq[i] = row[col]));
    return sq;
  });
  // Pad to square if r > n (degenerate tiny cases) — solveSquare needs r×r.
  if (pick.length !== r) return null;

  const x = solveSquare(square, s, counter);
  if (!x) return null; // singular guess — retry
  counter.ops++; // the one candidate this iteration tests
  if (weight(x) > w) return null; // too heavy — retry

  const e = new Uint8Array(n);
  pick.forEach((col, i) => (e[col] = x[i]));
  return e;
}

/**
 * Run the real ISD attack. Applies perfect hints first (shrinking the instance),
 * then loops Prange until it recovers a weight-≤w error, and finally verifies
 * the reconstructed full-length e against the ORIGINAL (H, s). The returned
 * iteration count is the honest, measured cost of this run.
 */
export function runAttack(
  inst: Instance,
  hints: PerfectHint[] = [],
  opts: AttackOptions = {},
): AttackResult {
  const seed = opts.seed ?? 0x51ab1e;
  const maxIterations = opts.maxIterations ?? 200_000;
  const rng = mulberry32(seed);
  const red = reduceWithHints(inst, hints);
  const counter: OpCounter = { ops: 0 };

  const reduced = { n: red.n, r: red.r, w: red.w };

  // Degenerate: hints already pinned the whole error (residual weight 0). The
  // residual e is all-zeros and s must already be zero — verify and return.
  if (red.w <= 0) {
    const full = reconstruct(inst.n, new Uint8Array(red.n), red);
    const verified = matVec(inst.H, full).every((b, i) => b === inst.s[i]) && weight(full) <= inst.w;
    return { solved: verified, recovered: verified ? full : null, iterations: 0, work: 0, verified, reduced };
  }

  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    const residual = prangeOnce(red.H, red.s, red.r, red.n, red.w, rng, counter);
    if (!residual) continue;
    const full = reconstruct(inst.n, residual, red);
    const ok = matVec(inst.H, full).every((b, i) => b === inst.s[i]);
    if (ok && weight(full) <= inst.w) {
      return { solved: true, recovered: full, iterations, work: counter.ops, verified: true, reduced };
    }
  }
  return { solved: false, recovered: null, iterations, work: counter.ops, verified: false, reduced };
}

/** Splice a reduced-instance residual back into a full-length error vector. */
export function reconstruct(n: number, residual: Vec, red: Reduced): Vec {
  const full = new Uint8Array(n);
  for (const idx of red.fixedOnes) full[idx] = 1;
  red.colMap.forEach((orig, i) => {
    if (residual[i]) full[orig] = 1;
  });
  return full;
}
