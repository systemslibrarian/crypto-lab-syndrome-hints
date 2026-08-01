// ---------------------------------------------------------------------------
// The work-factor model — the curve that slides exponential → polynomial.
//
// For a Prange-style ISD, the expected number of random guesses to confine a
// weight-w error to r chosen columns is C(n,w) / C(r,w); each guess costs a
// GF(2) inversion of an r×r matrix, ≈ r^3 bit operations. So:
//
//     log2(work)  =  [ log2 C(n,w) − log2 C(r,w) ]   +   3·log2(r)
//                     └──────── search exponent ─────┘   └ poly floor ┘
//
// The search exponent is the exponential part; the poly floor is what remains
// when the exponent reaches 0. THAT is the whole story of the demo: hints drive
// the search exponent to zero, and the work factor lands on the polynomial
// floor. This is a transparent Prange model, labelled as such in the UI — it is
// backed by the actually-measured iteration counts of sdp/isd.ts for the
// perfect-hint path.
// ---------------------------------------------------------------------------

/**
 * log2 C(n, k), computed as Σ log2((n−k+i)/i) for i=1..k — accurate to machine
 * precision and overflow-free even for n on the order of the real code lengths
 * (a few thousand). Returns −Infinity when the binomial is 0 (k>n or k<0).
 */
export function log2Binom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  const kk = Math.min(k, n - k); // symmetry keeps the loop short
  let bits = 0;
  for (let i = 1; i <= kk; i++) bits += Math.log2((n - kk + i) / i);
  return bits;
}

export interface WorkInputs {
  n: number;
  r: number;
  w: number;
}

// ---------------------------------------------------------------------------
// Total work in a shared unit (GF(2) row-combine operations), so Prange and
// Stern are directly comparable. Both pay a Gaussian-elimination cost per
// permutation; Prange tests one candidate per permutation, Stern amortises the
// elimination over a birthday/collision search of the information set. Standard
// cost model (Stern 1989; Bernstein–Lange–Peters, "Attacking and defending the
// McEliece cryptosystem", PQCrypto 2008).
// ---------------------------------------------------------------------------

/** Elimination cost per permutation, in row-combines (Gauss–Jordan ≈ r²). */
export function elimOps(r: number): number {
  return Math.max(1, r * r);
}

/** Prange total work (log2 row-combines): E[iters] × elimination cost. */
export function prangeWorkBits(inp: WorkInputs): number {
  return searchExponentBits(inp) + Math.log2(elimOps(inp.r));
}

export interface SternParams {
  p: number;
  l: number;
}

/** log2 of Stern's expected permutations for a given (p, l). */
function sternIterBits(n: number, r: number, w: number, p: number, l: number): number {
  const k = n - r;
  const k1 = Math.floor(k / 2);
  const k2 = k - k1;
  const den = log2Binom(k1, p) + log2Binom(k2, p) + log2Binom(r - l, w - 2 * p);
  if (!isFinite(den)) return Infinity;
  return log2Binom(n, w) - den;
}

/** Stern per-permutation work: elimination + two lists + expected collisions. */
function sternPerIter(n: number, r: number, p: number, l: number): number {
  const k = n - r;
  const k1 = Math.floor(k / 2);
  const k2 = k - k1;
  const lx = Math.pow(2, log2Binom(k1, p));
  const ly = Math.pow(2, log2Binom(k2, p));
  return elimOps(r) + lx + ly + (lx * ly) / Math.pow(2, l);
}

/** Stern total work (log2 row-combines) at a given (p, l). */
export function sternWorkBitsAt(inp: WorkInputs, p: number, l: number): number {
  const iters = sternIterBits(inp.n, inp.r, inp.w, p, l);
  if (!isFinite(iters)) return Infinity;
  return iters + Math.log2(sternPerIter(inp.n, inp.r, p, l));
}

/**
 * Pick the (p, l) that minimise Stern's total work for this instance — the real
 * solver uses exactly these, so the measured run tracks the modelled curve.
 * Returns p = 0 as a degenerate fallback when the residual weight is too small
 * to split (Stern collapses toward a single-candidate test).
 */
export function bestSternParams(inp: WorkInputs): SternParams {
  const { n, r, w } = inp;
  const k = n - r;
  const k1 = Math.floor(k / 2);
  const k2 = k - k1;
  if (w < 2 || k1 < 1 || k2 < 1) return { p: 0, l: Math.min(1, r) };
  // Baseline is the Prange fallback (p = 0): a real attacker never does worse
  // than Prange, so only a birthday split that BEATS it is worth picking. This
  // also keeps the work curve monotone in the hint count — Stern converges onto
  // Prange in the low-weight regime, where the birthday overhead stops paying.
  let best: SternParams = { p: 0, l: Math.min(1, r) };
  let bestBits = prangeWorkBits(inp);
  const pMax = Math.min(3, Math.floor(w / 2), k1, k2);
  for (let p = 1; p <= pMax; p++) {
    const lMax = r - (w - 2 * p);
    for (let l = 1; l <= Math.min(r - 1, lMax); l++) {
      const bits = sternWorkBitsAt(inp, p, l);
      if (bits < bestBits) {
        bestBits = bits;
        best = { p, l };
      }
    }
  }
  return best;
}

/** Stern total work at its optimal (p, l). */
export function sternWorkBits(inp: WorkInputs): number {
  if (inp.w <= 0) return Math.log2(elimOps(inp.r));
  const { p, l } = bestSternParams(inp);
  if (p === 0) return prangeWorkBits(inp); // degenerate: no birthday advantage
  return sternWorkBitsAt(inp, p, l);
}

/** The exponential part alone: log2 of expected Prange iterations. */
export function searchExponentBits({ n, r, w }: WorkInputs): number {
  if (w <= 0) return 0;
  const num = log2Binom(n, w);
  const den = log2Binom(r, w); // −Infinity when r < w (can't fit the error)
  if (!isFinite(den)) return num; // error can't be confined; exponent ≈ full
  return Math.max(0, num - den);
}

/** Per-iteration polynomial cost in bits: an r×r GF(2) inversion, ≈ r^3. */
export function polyFloorBits(r: number): number {
  return 3 * Math.log2(Math.max(2, r));
}

/** Total modelled work, log2(bit operations). */
export function workBits(inp: WorkInputs): number {
  return searchExponentBits(inp) + polyFloorBits(inp.r);
}

export interface CurvePoint {
  /** Number of hints applied so far. */
  hints: number;
  /** Residual instance after the hints. */
  n: number;
  w: number;
  /** log2 work at this hint count. */
  bits: number;
  /** True once the search exponent has collapsed to 0 (polynomial time). */
  polynomial: boolean;
}

export interface CurveParams {
  n: number;
  r: number;
  w: number;
  /** Max hints to plot (defaults to w — the point where the support is fully known). */
  maxHints?: number;
  /**
   * Soft-decision bits each *approximate* hint shaves off the search exponent.
   * 0 means the curve is a pure perfect-hint curve (support reveal). This is the
   * modelled knob; the perfect-hint reveal (below) is exact and runnable.
   */
  softBitsPerHint?: number;
}

/**
 * The headline curve. Perfect hints reveal support coordinates: each one drops
 * n by 1 and w by 1 until w hits 0, at which point the instance is solved and
 * work sits on the polynomial floor. `softBitsPerHint` optionally models the
 * gentler saving of approximate (noisy-weight) hints on top.
 */
export function workCurve(p: CurveParams): CurvePoint[] {
  const maxHints = p.maxHints ?? p.w;
  const soft = p.softBitsPerHint ?? 0;
  const pts: CurvePoint[] = [];
  for (let h = 0; h <= maxHints; h++) {
    const revealed = Math.min(h, p.w); // support coords revealed by perfect hints
    const n = p.n - revealed;
    const w = p.w - revealed;
    const floor = polyFloorBits(p.r);
    const exponent = Math.max(0, searchExponentBits({ n, r: p.r, w }) - soft * h);
    const bits = exponent + floor;
    pts.push({ hints: h, n, w, bits, polynomial: exponent <= 0.5 });
  }
  return pts;
}

/**
 * Information a single *approximate* hint carries, in bits. A noisy meter that
 * reports the weight of a size-b block can distinguish up to (b+1) outcomes —
 * log2(b+1) bits if perfect — and `noiseBits` of that is destroyed by the
 * measurement noise. The leftover is the soft-decision saving the model applies
 * to the search exponent. Clamped to [0, log2(b+1)]. This is a model of the
 * side-channel path (ISD-with-Hints, ePrint 2021/279), clearly labelled as such
 * in the UI — unlike the perfect-hint path, it is not executed.
 */
export function approxGainBits(blockSize: number, noiseBits: number): number {
  const max = Math.log2(Math.max(1, blockSize) + 1);
  return Math.min(max, Math.max(0, max - noiseBits));
}

/**
 * The explicit hint-count-to-polynomial bound: how many perfect (support)
 * hints collapse the instance to polynomial time. For error-location leakage
 * that is exactly w — reveal the whole support and nothing is left to search.
 *
 * Note what is NOT in this bound: the code length n. Fragility here is a
 * function of the ABSOLUTE error weight alone, so a lighter error falls after
 * fewer hints and a heavier one resists. Relative weight t/n changes how hard
 * the instance is at zero hints, not how many hints end it — which is why this
 * bound does not separate mceliece348864 (t = 64) from hqc-128 (t = 66).
 */
export function hintsToPolynomial(w: number): number {
  return w;
}
