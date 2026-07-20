# Syndrome Hints

**Hint-ISD · IACR ePrint 2026/341** — a browser demo that runs a *real*
information-set-decoding (ISD) attack on a syndrome-decoding instance over F₂ and
slides its work factor from **exponential (no hints)** toward **polynomial (enough
hints)** as leaked side-channel "hints" accumulate. You add the hints; the curve
collapses; the attack actually runs and verifies its answer.

> Not production crypto — a teaching demo. It attacks small but genuine F₂
> instances; it runs no real Classic McEliece or HQC key recovery.

## What It Is

Code-based post-quantum schemes (**Classic McEliece**, **HQC**) rest on the
**syndrome-decoding problem (SDP)**: given a public parity-check matrix `H` and a
syndrome `s = H·e`, recover the low-weight error vector `e`. With no side
information the best known attacks (the **ISD** family — Prange, Stern, MMT,
BJMM) cost exponential time.

The **Hint-ISD** result (D'Achille, Esser, Kraus, ePrint 2026/341, building on
Cayrel et al. Eurocrypt '21 and ISD-with-Hints ePrint 2021/279) asks what happens
when the secret error partially leaks — through a **fault** or a **side channel**.
Each leaked hint turns the problem into **soft-decision decoding**, and the work
factor slides smoothly from exponential toward polynomial.

> **Scope note (Adapted).** This demo models a perfect hint as a direct
> **support-coordinate reveal** (an exact leaked `e_i`) and an approximate hint as
> a noisy block-weight meter. Those are deliberately strong, simplified stand-ins
> chosen so the effect is easy to see and run; the paper's hint channel is more
> general. Treat the "≈ w hints to polynomial" bound and the McEliece-vs-HQC
> panel as illustrations of the *mechanism*, not verbatim reproductions of the
> paper's quantitative results.

The best-known classical attacks form the **ISD family** — of which **Prange**
and **Stern** are implemented here as two selectable real solvers, while **MMT**
and **BJMM** are named as further refinements but are *not* implemented.

This demo makes that concrete:

- **Real crypto.** `src/sdp/` hand-rolls the F₂ linear algebra, builds genuine
  SDP instances (`H`, `s`, planted low-weight `e`), and runs **two real ISD
  solvers** — Prange (`src/sdp/isd.ts`) and Stern (`src/sdp/stern.ts`) — each of
  which recovers `e` and **verifies `H·e = s`**. Stern performs a genuine
  birthday/collision search over the information set, not a Prange loop renamed.
  The perfect-hint path is executed for both, not simulated.
- **Security model.** The attacker sees only `(H, s)` plus whatever hints you
  leak. Nothing is persisted; every instance is generated per session from a seed.
- **What it recovers.** The **error vector `e`** — *not* a decryption forgery or a
  full key. That distinction is stated throughout the UI.

## Exhibits

1. **See the problem** — a real `H` (`24×48`) and syndrome `s`; flip a candidate
   `e` by hand and watch `H·e` get compared, bit for bit, against `s`.
2. **Break it yourself** — a real **algorithm selector (Prange | Stern)** drives
   which genuine solver runs. Leak coordinates of the true error with the
   perfect-hint slider, then press **Run the real ISD attack**: the chosen decoder
   solves the residual instance and reports the permutations and GF(2) operations
   it actually took (and, for Stern, the birthday parameters `p`, `ℓ` it used).
3. **Watch it collapse** — the headline chart: **two real work-factor curves**
   (Prange and Stern) versus hint count. The vertical gap between them is the
   algorithm advantage; sliding right is the hint axis. Both fall to the
   polynomial floor once the support is known, with the **measured** averages of
   the real runs you launch overlaid as dots.
4. **Approximate hints (model)** — the soft-decision recasting of a noisy
   Hamming-weight leak, with a noise slider and the information-gain formula.
5. **McEliece vs HQC** — the paper's error-weight finding: run both toy instances
   and see the low-weight scheme reach polynomial time after far fewer hints.
6. **Reference** — the exact Prange work-factor formula, the explicit
   hint-count-to-polynomial bound (`≈ w`), and the sources.

## When to Use It

- **Use it** to teach why code-based security depends on the *secrecy of the whole
  error*, and how fault/side-channel leakage — not a break of the math — degrades
  it; and to build intuition for why low-weight schemes are more hint-fragile.
- **Do NOT use it** as an attack tool or a security estimate for real parameters.
  The runnable instances are tiny by design; the real Level-1 numbers are quoted
  as facts, not reproduced.

## Live Demo

<https://systemslibrarian.github.io/crypto-lab-syndrome-hints/>

Drag the hint slider, run the real attack, and compare the measured red dot to the
modelled orange curve. Toggle the theme in the top bar; both are AA-accessible.

## What Can Go Wrong

- **Reading it as a break.** With zero hints the search is fully exponential — the
  schemes are sound. This is *leakage-assisted* decoding.
- **Over-trusting a single run.** One ISD run is a random draw around the expected
  work; the demo averages several so the measured dot sits near the curve, and it
  says so.
- **Confusing model with measurement.** The perfect-hint attack is executed; the
  work-factor curve and the approximate-hint discount are transparent **models**,
  labelled where shown.
- **Assuming faults always help maximally.** The slider leaks *informative*
  (support) coordinates; faults that hit zeros help less. The `≈ w` bound is the
  best case.

## Real-World Usage

The lineage is live cryptographic-engineering concern: fault attacks (Cayrel et
al.) and template/power-analysis attacks against code-based KEM implementations
motivate constant-time decoders, fault-detection, and masking. Hint-ISD quantifies
how much a given amount of leakage is worth to an attacker — directly relevant to
Classic McEliece and HQC as they move through standardisation.

## How to Run Locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest unit tests + spec KATs
npm run build      # tsc --noEmit && vite build
npm run test:a11y  # axe-core WCAG gate on the production build, both themes
```

## Related Demos

- [crypto-lab-syndrome-drain](https://systemslibrarian.github.io/crypto-lab-syndrome-drain/) — multi-instance (DOOM) degradation of code-based KEMs
- [crypto-lab-mceliece-gate](https://systemslibrarian.github.io/crypto-lab-mceliece-gate/) — Classic McEliece up close
- [crypto-lab-hqc-vault](https://systemslibrarian.github.io/crypto-lab-hqc-vault/) — HQC's quasi-cyclic structure
- [crypto-lab-lwe-hints](https://systemslibrarian.github.io/crypto-lab-lwe-hints/) — the lattice analogue: LWE with hints

## Build & Verify

- **Unit tests:** 47 Vitest tests across `src/sdp/*.test.ts`, run in CI before every
  deploy. This includes **16 spec known-answer tests** for the [7,4] Hamming code:
  9 syndrome KATs (`src/sdp/instance.test.ts`) — every single-bit error has syndrome
  equal to its position's binary value, plus zero-syndrome and XOR-linearity — and
  **7 Stern decoding KATs** (`src/sdp/stern.test.ts`), where Stern recovers each
  canonical single-bit error of the Hamming code.
- **Correctness embodied:** the Prange tests (`src/sdp/isd.test.ts`) and Stern tests
  (`src/sdp/stern.test.ts`) confirm each real attack recovers `e` with `H·e = s`
  verified, that revealing the full support collapses the search to 0 iterations
  (polynomial), and that more support hints lower the cost. A dedicated test asserts
  Stern's measured work is genuinely **lower than Prange's** on the same instance —
  the whole point of the second algorithm.
- **Work-factor model:** `src/sdp/workfactor.test.ts` checks the Prange curve is
  monotonically non-increasing in hints and hits the polynomial floor at `w` hints,
  and that the Stern model work is strictly below Prange until both reach the floor.
- **Implemented algorithms:** Prange and Stern only. MMT and BJMM are named as
  further ISD refinements but are not implemented.
- **Accessibility gate:** `@axe-core/playwright` scans the production build for zero
  WCAG 2.1 A/AA violations in **both** themes; it drives every panel (attack, chart,
  comparison, approximate-hints, details) into its post-interaction state first. The
  GitHub Pages deploy is blocked on any violation.

## Performance

The instance is an honestly-labelled toy (`n = 48`, `w = 10`) — sized so Prange
visibly struggles where Stern does not, yet both real solvers finish in a few
milliseconds on a desktop browser. All computation is in the browser — no
backend, no network calls.

---

*One of 120+ browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
