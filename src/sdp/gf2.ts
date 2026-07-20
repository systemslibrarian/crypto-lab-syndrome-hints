// ---------------------------------------------------------------------------
// GF(2) linear algebra — the inspectable arithmetic every panel stands on.
//
// This is hand-rolled on purpose (Principle 1: the primitive that *is* the
// teaching subject is transparent, not hidden in a library). Vectors and
// matrices hold 0/1 bytes so a learner can print and read them; all math is
// mod 2 (XOR = addition, AND = multiplication). Sizes here are tiny (n <= ~32),
// so byte arrays are plenty fast and stay legible.
// ---------------------------------------------------------------------------

/** A GF(2) vector: each entry is exactly 0 or 1. */
export type Vec = Uint8Array;

/** A GF(2) matrix as an array of row vectors, all the same length. */
export type Mat = Vec[];

export function zeros(n: number): Vec {
  return new Uint8Array(n);
}

/** Hamming weight — the number of 1s. This is the quantity SDP minimises. */
export function weight(v: Vec): number {
  let w = 0;
  for (let i = 0; i < v.length; i++) w += v[i] & 1;
  return w;
}

/** In-place-free XOR of two equal-length vectors (GF(2) addition). */
export function xor(a: Vec, b: Vec): Vec {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ^ b[i]) & 1;
  return out;
}

export function equal(a: Vec, b: Vec): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] & 1) !== (b[i] & 1)) return false;
  return true;
}

/** Extract column j of H as a vector (length = number of rows). */
export function column(H: Mat, j: number): Vec {
  const col = new Uint8Array(H.length);
  for (let r = 0; r < H.length; r++) col[r] = H[r][j] & 1;
  return col;
}

/**
 * Matrix times vector over GF(2): (H · e)_r = XOR over columns j of H[r][j]·e[j].
 * This is the whole definition of a syndrome — each output bit is the parity of
 * the error bits the corresponding parity-check row touches.
 */
export function matVec(H: Mat, e: Vec): Vec {
  const rows = H.length;
  const s = new Uint8Array(rows);
  for (let r = 0; r < rows; r++) {
    let acc = 0;
    const row = H[r];
    for (let j = 0; j < e.length; j++) acc ^= row[j] & e[j];
    s[r] = acc & 1;
  }
  return s;
}

/**
 * A shared work counter. Both solvers increment it once per GF(2) row-combine
 * (and per candidate test), so Prange and Stern report cost in the same unit and
 * their measured work factors are directly comparable.
 */
export interface OpCounter {
  ops: number;
}

/**
 * Solve M · x = b for x over GF(2), where M is square (r×r), via Gauss–Jordan
 * elimination. Returns the unique solution, or null if M is singular. Used by
 * Prange ISD to invert the r columns it guesses form the error's support. If a
 * counter is passed, each row-combine bumps it (the comparable work unit).
 */
export function solveSquare(M: Mat, b: Vec, counter?: OpCounter): Vec | null {
  const r = M.length;
  // Augmented copy [M | b]; never mutate the caller's matrix.
  const A: Uint8Array[] = M.map((row, i) => {
    const a = new Uint8Array(r + 1);
    a.set(row.subarray(0, r));
    a[r] = b[i] & 1;
    return a;
  });

  for (let col = 0; col < r; col++) {
    let pivot = -1;
    for (let row = col; row < r; row++) {
      if (A[row][col] & 1) {
        pivot = row;
        break;
      }
    }
    if (pivot === -1) return null; // singular: this column set is not invertible
    if (pivot !== col) {
      const tmp = A[pivot];
      A[pivot] = A[col];
      A[col] = tmp;
    }
    for (let row = 0; row < r; row++) {
      if (row !== col && A[row][col] & 1) {
        for (let c = col; c <= r; c++) A[row][c] ^= A[col][c];
        if (counter) counter.ops++;
      }
    }
  }

  const x = new Uint8Array(r);
  for (let i = 0; i < r; i++) x[i] = A[i][r] & 1;
  return x;
}
