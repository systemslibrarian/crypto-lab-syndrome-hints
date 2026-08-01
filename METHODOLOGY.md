# Methodology — what is real, what is modelled, and where each claim lives

This demo aims to be auditable: every claim it makes should trace to a definition,
a piece of code, a test, and a place in the UI. This document is that trace.

## Source versions (pinned)

| Item | Version / date | URL |
| --- | --- | --- |
| Syndrome Decoding with Hints (framing) — D'Achille, Esser, Kraus | IACR ePrint 2026/341 | <https://eprint.iacr.org/2026/341> |
| Information-Set Decoding with Hints — Horlemann, Puchinger, Renner, Schamberger, Wachter-Zeh. **Source of both hints implemented here:** known error locations and known subblock Hamming weights | IACR ePrint 2021/279 | <https://eprint.iacr.org/2021/279> |
| Fault attack revealing **syndrome entries over the integers** (Hint-ISD's "perfect hints"). A different channel — cited, **not** implemented | Cayrel et al., Eurocrypt 2021 | — |
| Stern's algorithm | Stern 1989; Bernstein–Lange–Peters, PQCrypto 2008 | — |
| Classic McEliece (real params) | mceliece348864, NIST L1 | <https://classic.mceliece.org/> |
| HQC (real params) | hqc-128, NIST L1 | <https://pqc-hqc.org/> |

Abstracts re-checked 2026-08-01. Per 2026/341's own abstract, the Cayrel et al.
fault attack it builds on "exploits a fault injection attack to reveal syndrome
entries over the integers, referred to as perfect hints" — integer-valued
*syndrome* components, with the modular reduction suppressed. That is **not** the
channel this demo implements. What this demo implements is the **known error
locations** hint of 2021/279 (the attacker learns which coordinates of `e` are
set), plus 2021/279's known-subblock-weight hint as the modelled approximate
path. 2026/341 supplies the framing this demo visualises — hints recast the SDP
as soft-decision decoding, and adapted ISD interpolates from exponential toward
polynomial — and is cited for that, not as the source of the leakage oracle.

The PDFs were behind a browser challenge, so the work-factor estimator here is
presented as an **adaptation** calibrated against the demo's own solvers, not a
reproduction of either paper's formal analysis.

## Real vs modelled vs quoted

- **Executed.** The SDP instances, syndromes, and both ISD attacks (Prange and
  Stern) run in the browser and every recovered `e` is verified against `H·e = s`.
- **Estimated.** The work-factor curves are closed-form models, calibrated to the
  real solvers' operation counts (see calibration below).
- **Quoted.** Real McEliece/HQC parameters are cited facts; the browser attacks
  only the small toys.
- **Adapted.** A perfect hint is a direct error-coordinate reveal (2021/279's
  known-error-locations hint), and the slider always leaks *informative* support
  coordinates, so the "≈ w hints" bound is that leakage model's best case.

## Claim → source → code → test → UI

| Claim | Basis | Code | Test | UI |
| --- | --- | --- | --- | --- |
| `s = H·e` over F₂; each syndrome bit is a parity | definition | `sdp/gf2.ts` `matVec` | `gf2.test.ts`, `instance.test.ts` (Hamming KATs) | Primer card |
| Prange recovers `e`, verified | Prange ISD | `sdp/isd.ts` `runAttack` | `isd.test.ts` | Attack panel |
| Stern is a genuine birthday/collision search, cheaper than Prange | Stern 1989 | `sdp/stern.ts` `runStern` | `stern.test.ts` (incl. Hamming KATs, Stern<Prange) | Attack panel + selector |
| Only Prange & Stern are implemented (MMT/BJMM named) | scope | `sdp/stern.ts` `// [extension] point` | — | Explainer, FAQ, caveats |
| Perfect hint shrinks the instance (shared reduction) | known-error-locations hint, ePrint 2021/279 (adapted) | `sdp/isd.ts` `reduceWithHints`/`reconstruct` | `adversarial.test.ts` (round-trip) | Hint slider |
| Work slides exponential → polynomial; ≈ w hints to poly | this model | `sdp/workfactor.ts` `workCurve`, `hintsToPolynomial` | `workfactor.test.ts` | Curve card |
| Stern model < Prange model, monotone in hints | cost model | `sdp/workfactor.ts` `sternWorkBits`/`prangeWorkBits` | `workfactor.test.ts` | Curve card |
| Measured medians land near the modelled curves | calibration | `sdp/*` counters | `adversarial.test.ts` (calibration) | Chart dots + data table |
| Solvers are bounded-weight decoders, fail-closed on bad hints | correctness | `sdp/isd.ts`, `sdp/stern.ts` | `adversarial.test.ts` | — |
| A lower-weight error falls to poly after fewer hints; code length does not enter the bound (mechanism, shown on toys) | error-weight mechanism | `sdp/schemes.ts`, `sdp/workfactor.ts` `hintsToPolynomial` | `workfactor.test.ts` | Compare card |
| The bound does NOT separate the real Level-1 sets (t = 64 vs 66 ⇒ HQC needs two *more* hints) | this model, read literally | `sdp/schemes.ts` `realT` | `workfactor.test.ts` | Compare footnote, FAQ |
| Recovers `e`, not a decryption forgery | scope | — | — | Attack footnote, caveats, README |

## The work unit (operation ledger)

Both solvers increment a single `OpCounter` (`sdp/gf2.ts`) on comparable
elementary steps:

- **row-combines** during Gaussian elimination (`solveSquare`, and Stern's
  `toSystematic`);
- **candidate tests** — each candidate error whose weight is checked;
- **list entries** — Stern's collision-list construction.

The chart plots `log₂` of this ledger. The modelled curves use the matching
closed forms:

```
prange_bits(n,r,w) = [log₂ C(n,w) − log₂ C(r,w)]  +  log₂(r²)
stern_bits(n,r,w)  = min over (p,ℓ) of  iters(p,ℓ) + log₂(r² + |X| + |Y| + collisions),
                     never worse than the Prange fallback
```

## Instance sizing (Gilbert–Varshamov bound)

The main instance is `n=64, k=24, w=11`. It sits near the GV bound, so the planted
weight-11 error is essentially the **unique** low-weight solution. This matters:
away from the GV bound a coset has many low-weight solutions and ISD finds one far
faster than the unique-solution model predicts, which would make the curves
overstate the real work. At the GV bound the model is honest — the calibration
test confirms median measured work is within ~2 bits (Prange) of the model, with
Stern's model a mild conservative over-estimate.

## Known limitations

- The perfect-hint oracle is 2021/279's known-error-locations hint, specialised to
  always leak support coordinates; the "≈ w hints" bound is this model's best case.
- The Cayrel et al. syndrome-over-the-integers channel is not implemented, and
  nothing here should be read as a simulation of it.
- MMT/BJMM are not implemented.
- The McEliece-vs-HQC toys illustrate the weight→hints mechanism at two
  deliberately separated weights; they are not scaled models of the real schemes.
  Read literally at the real Level-1 numbers, `hintsToPolynomial` gives 64 hints
  for mceliece348864 and 66 for hqc-128 — it does not rank them. Their relative
  weights differ (1.8% vs 0.37%), but relative weight sets the curve's starting
  height, not the hint budget. Hint-ISD's own conclusion that higher-weight
  schemes resist hint exposure better rests on its full estimator, which this
  demo does not reproduce.
- Stern's estimator omits lower-order terms; it is calibrated, not derived to full
  precision.
