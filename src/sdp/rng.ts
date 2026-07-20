// A small deterministic PRNG (mulberry32). Instances and attack runs seed it
// explicitly so that what a learner sees is reproducible and the tests are
// deterministic — never Math.random() for anything a test or the UI asserts on.
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher–Yates shuffle of [0, n) using the given rng; returns a fresh array. */
export function shuffledIndices(rng: Rng, n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/** Pick `k` distinct indices from [0, n) without replacement. */
export function sample(rng: Rng, n: number, k: number): number[] {
  return shuffledIndices(rng, n).slice(0, k);
}
