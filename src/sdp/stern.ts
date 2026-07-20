// ---------------------------------------------------------------------------
// Stern's information-set decoder — the real thing, executed.
//
// Prange re-randomises and hopes the whole error avoids the information set.
// Stern (1989) does strictly more per permutation: it brings H to systematic
// form, splits the information set into two halves X and Y, and runs a
// birthday/collision search for an error that places exactly p ones in each
// half and zero ones in a chosen ℓ-row window — meeting in the middle on that
// window so most candidate pairs are discarded cheaply. That amortises the
// expensive Gaussian elimination over many candidates, so Stern needs far fewer
// permutations than Prange and a visibly lower total work factor.
//
// This is a genuine collision search, NOT a Prange loop renamed. It reuses the
// SAME Hint-ISD reduction (reduceWithHints / reconstruct) as the Prange path, so
// perfect hints shrink the instance for Stern exactly as they do for Prange, and
// it recovers the error vector e (verified H·e = s) — not a decryption forgery.
//
// Refinements above Stern (MMT, BJMM) are NOT implemented here; they remain
// named-only in the copy.
// ---------------------------------------------------------------------------

import { matVec, weight, type Mat, type OpCounter, type Vec } from './gf2';
import { mulberry32, shuffledIndices } from './rng';
import { reconstruct, reduceWithHints, type Reduced } from './isd';
import { bestSternParams } from './workfactor';
import type { AttackResult, Instance, PerfectHint } from './types';

export interface SternResult extends AttackResult {
  /** The (p, l) Stern actually ran with (p = 0 ⇒ degenerate single-candidate). */
  params: { p: number; l: number };
}

export interface SternOptions {
  seed?: number;
  maxIterations?: number;
}

/** All weight-p index subsets of `arr` (p is small: 0–3). */
function combinations(arr: number[], p: number): number[][] {
  if (p === 0) return [[]];
  const out: number[][] = [];
  const pick = (start: number, chosen: number[]) => {
    if (chosen.length === p) {
      out.push(chosen.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      chosen.push(arr[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

interface Systematic {
  pivotCol: number[]; // pivotCol[i] = column pivoted on in pivot-row i
  infoCols: number[]; // columns not chosen as pivots (the information set)
  q: Map<number, Vec>; // info column j → its length-r vector in the pivot basis
  sp: Vec; // reduced syndrome, indexed by pivot row
}

/**
 * Gauss–Jordan reduce H to systematic form under a random column order, tracking
 * which columns became pivots (the redundant set) and which stayed in the
 * information set. Returns null if this order is rank-deficient (retry).
 */
function toSystematic(
  H: Mat,
  s: Vec,
  colOrder: number[],
  r: number,
  n: number,
  counter: OpCounter,
): Systematic | null {
  const rows: Uint8Array[] = H.map((row) => row.slice());
  const syn = s.slice();
  const used = new Array<boolean>(n).fill(false);
  const pivotCol: number[] = [];
  let pivotRow = 0;

  for (const col of colOrder) {
    if (pivotRow >= r) break;
    let pr = -1;
    for (let row = pivotRow; row < r; row++) {
      if (rows[row][col] & 1) {
        pr = row;
        break;
      }
    }
    if (pr === -1) continue; // no pivot in this column under current elimination
    if (pr !== pivotRow) {
      const tr = rows[pr];
      rows[pr] = rows[pivotRow];
      rows[pivotRow] = tr;
      const ts = syn[pr];
      syn[pr] = syn[pivotRow];
      syn[pivotRow] = ts;
    }
    for (let row = 0; row < r; row++) {
      if (row !== pivotRow && rows[row][col] & 1) {
        for (let c = 0; c < n; c++) rows[row][c] ^= rows[pivotRow][c];
        syn[row] ^= syn[pivotRow];
        counter.ops++; // one GF(2) row-combine — the shared work unit
      }
    }
    used[col] = true;
    pivotCol.push(col);
    pivotRow++;
  }

  if (pivotRow < r) return null; // rank-deficient permutation

  const infoCols: number[] = [];
  for (let c = 0; c < n; c++) if (!used[c]) infoCols.push(c);

  const q = new Map<number, Vec>();
  for (const j of infoCols) {
    const col = new Uint8Array(r);
    for (let i = 0; i < r; i++) col[i] = rows[i][j] & 1;
    q.set(j, col);
  }
  return { pivotCol, infoCols, q, sp: syn };
}

/** XOR the length-r vectors for a set of info columns into a fresh vector. */
function sumCols(q: Map<number, Vec>, cols: number[], r: number): Vec {
  const v = new Uint8Array(r);
  for (const j of cols) {
    const qj = q.get(j)!;
    for (let i = 0; i < r; i++) v[i] ^= qj[i];
  }
  return v;
}

/** Pack the first ℓ bits of a length-r vector into an integer key. */
function windowKey(v: Vec, l: number): number {
  let key = 0;
  for (let i = 0; i < l; i++) key = (key << 1) | (v[i] & 1);
  return key >>> 0;
}

/**
 * Run the real Stern attack on the reduced instance. Returns the recovered,
 * verified error vector and the measured work in the shared row-combine unit.
 */
export function runStern(
  inst: Instance,
  hints: PerfectHint[] = [],
  opts: SternOptions = {},
): SternResult {
  const seed = opts.seed ?? 0x57e42;
  const maxIterations = opts.maxIterations ?? 40_000;
  const red = reduceWithHints(inst, hints);
  const counter: OpCounter = { ops: 0 };
  const reduced = { n: red.n, r: red.r, w: red.w };
  const { p, l } = bestSternParams({ n: red.n, r: red.r, w: red.w });
  const params = { p, l };

  // Degenerate: hints already pinned the whole error.
  if (red.w <= 0) {
    const full = reconstruct(inst.n, new Uint8Array(red.n), red);
    const verified = matVec(inst.H, full).every((b, i) => b === inst.s[i]) && weight(full) <= inst.w;
    return { solved: verified, recovered: verified ? full : null, iterations: 0, work: 0, verified, reduced, params };
  }

  const rng = mulberry32(seed);
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    const colOrder = shuffledIndices(rng, red.n);
    const sys = toSystematic(red.H, red.s, colOrder, red.r, red.n, counter);
    if (!sys) continue;

    const residual = sternSearch(sys, red, p, l, counter);
    if (!residual) continue;

    const full = reconstruct(inst.n, residual, red);
    const ok = matVec(inst.H, full).every((b, i) => b === inst.s[i]);
    if (ok && weight(full) <= inst.w) {
      return { solved: true, recovered: full, iterations, work: counter.ops, verified: true, reduced, params };
    }
  }
  return { solved: false, recovered: null, iterations, work: counter.ops, verified: false, reduced, params };
}

/**
 * The birthday/collision core: find an error with p ones in each half of the
 * information set and zero ones in the ℓ-window, whose residual on the pivot
 * columns has the remaining weight w − 2p. Returns the reduced-length error, or
 * null. Every list entry built and every full collision checked bumps the shared
 * work counter, so Stern's measured cost includes its search, not just its
 * permutations.
 */
function sternSearch(sys: Systematic, red: Reduced, p: number, l: number, counter: OpCounter): Vec | null {
  const r = red.r;
  const w = red.w;
  const info = sys.infoCols;

  // Degenerate p = 0 (residual weight too small to split): the only candidate is
  // e_info = 0, so e_pivot = sp; accept if its weight matches.
  if (p === 0) {
    counter.ops++;
    if (weight(sys.sp) === w) return residualFrom(sys, [], sys.sp, red.n);
    return null;
  }

  // [extension] point: MMT/BJMM refine THIS middle step — recursively building
  // the two lists with representations instead of a flat split. Named-only for
  // now; a future variant would swap out this two-list collision search.
  const half = Math.floor(info.length / 2);
  const X = info.slice(0, half);
  const Y = info.slice(half);
  if (X.length < p || Y.length < p) return null;

  // Build the X-side list keyed by the ℓ-window projection of Σ q_j.
  const table = new Map<number, { cols: number[]; v: Vec }[]>();
  for (const A of combinations(X, p)) {
    const vA = sumCols(sys.q, A, r);
    counter.ops++; // one list entry built
    const key = windowKey(vA, l);
    const bucket = table.get(key);
    if (bucket) bucket.push({ cols: A, v: vA });
    else table.set(key, [{ cols: A, v: vA }]);
  }

  // Meet in the middle from the Y side.
  for (const B of combinations(Y, p)) {
    const vB = sumCols(sys.q, B, r);
    counter.ops++; // one list entry built
    // We need window(sp ⊕ vA ⊕ vB) = 0 ⇒ window(vA) = window(sp ⊕ vB).
    const target = windowKey(xor3Window(sys.sp, vB, l), l);
    const bucket = table.get(target);
    if (!bucket) continue;
    for (const { cols: A, v: vA } of bucket) {
      // Full residual on the pivot columns: eR = sp ⊕ vA ⊕ vB.
      const eR = new Uint8Array(r);
      for (let i = 0; i < r; i++) eR[i] = (sys.sp[i] ^ vA[i] ^ vB[i]) & 1;
      counter.ops++; // one full candidate checked
      if (weight(eR) === w - 2 * p) {
        return residualFrom(sys, A.concat(B), eR, red.n);
      }
    }
  }
  return null;
}

/** window(a ⊕ b) restricted to the first l rows, returned as a length-r vector. */
function xor3Window(a: Vec, b: Vec, l: number): Vec {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < l; i++) out[i] = (a[i] ^ b[i]) & 1;
  return out;
}

/** Assemble the reduced-length error from info columns + pivot residual. */
function residualFrom(sys: Systematic, infoOnes: number[], eR: Vec, n: number): Vec {
  const e = new Uint8Array(n);
  for (const j of infoOnes) e[j] = 1;
  for (let i = 0; i < sys.pivotCol.length; i++) if (eR[i]) e[sys.pivotCol[i]] = 1;
  return e;
}
