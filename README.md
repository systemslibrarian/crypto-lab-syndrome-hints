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

The **Hint-ISD** result (D'Achille, Esser, Kraus, ePrint 2026/341) asks what
happens when the secret error partially leaks — through a **fault** or a **side
channel**. Each leaked hint turns the problem into **soft-decision decoding**, and
the work factor slides smoothly from exponential toward polynomial.

### Which hint channel this demo implements

There are two distinct hint channels in this literature, and this demo implements
one of them:

| Channel | What leaks | Source | Here? |
| --- | --- | --- | --- |
| **Known error locations** | the exact value of an error coordinate `e_i` — the attacker learns *where the error is* | Horlemann, Puchinger, Renner, Schamberger, Wachter-Zeh, *Information-Set Decoding with Hints*, [ePrint 2021/279](https://eprint.iacr.org/2021/279) | **implemented and executed** (the perfect-hint slider) |
| **Known subblock Hamming weights** | a noisy weight reading over a block of coordinates | same paper (template attacks) | **modelled** (the approximate-hint panel) |
| **Syndrome entries over the integers** | a fault suppresses the modular reduction, so the attacker reads integer-valued *syndrome* components — Hint-ISD's "perfect hints" | Cayrel et al., Eurocrypt '21, as described in [ePrint 2026/341](https://eprint.iacr.org/2026/341) | **cited as related work, not simulated** |

The third row is a genuinely different channel from the first: syndrome
components are not error positions, and this demo neither leaks nor models them.

> **Scope note (Adapted).** The slider leaks the *informative* (support)
> coordinates, so the "≈ w hints to polynomial" bound is this leakage model's
> best case rather than a verbatim restatement of Hint-ISD's general result.
> Treat that bound and the McEliece-vs-HQC panel as illustrations of the
> *mechanism*, not reproductions of the paper's quantitative results.

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

1. **Break it yourself** — a real **algorithm selector (Prange | Stern)** drives
   which genuine solver runs. Leak coordinates of the true error with the
   perfect-hint slider (the error vector is shown from the **attacker's view** —
   `?` for unknown, `🔓` for leaked — with an optional "show planted truth"), then
   press **Run**, **Run both**, or **Reset**. Each run is 15 seeded attacks; a
   **comparative results table** records the median work with a p10–p90 spread,
   the median permutations, and the `H·e = s` verification for every run.
2. **Watch it collapse** — the headline chart: **two real work-factor curves**
   (Prange and Stern) versus hint count. The vertical gap is the algorithm
   advantage; sliding right is the hint axis. Both fall to the polynomial floor
   once the support is known, with the **measured medians** of your runs overlaid
   as dots (and an accessible data table of every value).
3. **Inspect the instance** — the real `H` (`40×64`) and syndrome `s` you just
   attacked; an optional hand-decode exercise lets you flip a candidate `e` and
   watch `H·e` get compared, bit for bit, against `s`.
4. **Approximate hints (model)** — the soft-decision recasting of a noisy
   Hamming-weight leak, with a noise slider and the information-gain formula.
5. **McEliece vs HQC** — the error-weight *mechanism* on two toys: a lower-weight
   error reaches polynomial time after fewer support hints, and the code length
   does not enter the bound at all. Illustrative, not a scaled model of the real
   schemes — at the quoted Level-1 parameters the bound gives McEliece 64 hints
   and HQC 66, so it does not separate them.
6. **Reference** — the exact Prange and Stern work-factor formulas, the explicit
   hint-count-to-polynomial bound (`≈ w`), and the sources. See also
   [METHODOLOGY.md](METHODOLOGY.md) for the full claim → source → code → test → UI
   trace.

## When to Use It

- **Use it** to teach why code-based security depends on the *secrecy of the whole
  error*, and how fault/side-channel leakage — not a break of the math — degrades
  it; and to build intuition for why the error weight, not the code length, is
  what an error-location leak has to burn through.
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
al., leaking syndrome entries over the integers) and template/power-analysis
attacks against code-based KEM implementations (leaking error locations and
subblock weights — the channel this demo runs) motivate constant-time decoders,
fault-detection, and masking. Hint-ISD quantifies
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

- **Unit tests:** 60 Vitest tests across `src/sdp/*.test.ts`, run in CI before every
  deploy. This includes **16 spec known-answer tests** for the [7,4] Hamming code:
  9 syndrome KATs (`src/sdp/instance.test.ts`) — every single-bit error has syndrome
  equal to its position's binary value, plus zero-syndrome and XOR-linearity — and
  **7 Stern decoding KATs** (`src/sdp/stern.test.ts`), where Stern recovers each
  canonical single-bit error of the Hamming code.
- **Correctness embodied:** the Prange and Stern tests confirm each real attack
  recovers `e` with `H·e = s` verified, that full support leakage collapses the
  search to 0 iterations (polynomial), and that Stern's measured work is genuinely
  **lower than Prange's** on the same instance.
- **Cross-checked against ground truth:** `src/sdp/adversarial.test.ts` compares both
  solvers to **exhaustive minimum-weight decoding** on tiny instances, round-trips the
  hint reduction/reconstruction, checks fail-closed behaviour on contradictory hints,
  and **calibrates** the measured medians against the work model over a grid of
  Gilbert–Varshamov-bound instances (Prange within ~2 bits; Stern's model a mild
  conservative over-estimate).
- **Work-factor model:** `src/sdp/workfactor.test.ts` checks both curves are
  monotone in hints, hit the polynomial floor, and that Stern's model stays below
  Prange until both converge.
- **Behaviour gate:** `e2e/behavior.spec.ts` asserts the scientific contract in a
  real browser — the selected algorithm actually runs, results verify `H·e = s`, the
  two sliders stay in sync, Run both/Reset work, and there is no horizontal overflow
  at a 375 px phone width.
- **Implemented algorithms:** Prange and Stern only. MMT and BJMM are named as
  further ISD refinements but are not implemented.
- **Accessibility gate:** `@axe-core/playwright` scans the production build for zero
  WCAG 2.1 A/AA violations in **both** themes; it drives every panel into its
  post-interaction state (both solvers, the run table, the attacker/planted views,
  all details) first. The GitHub Pages deploy is blocked on any violation.

## Performance

The instance is an honestly-labelled toy at the **Gilbert–Varshamov bound**
(`n = 64`, `k = 24`, `w = 11`) — the planted error is essentially the unique
low-weight solution, so the work model is faithful, and it is sized so Prange
visibly struggles where Stern does not. Both real solvers finish in a few
milliseconds on a desktop browser. All computation is in the browser — no
backend, no network calls.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
