# Syndrome Hints: What Would Make This a 10/10 Gold-Standard Demo

## Bottom line

This is already a strong browser demo: it contains genuine GF(2) instances, two
real decoders, deterministic runs, answer verification, a model/measurement
distinction, strict TypeScript, 47 passing unit tests, and a two-theme axe gate.
Those are unusually good foundations.

It is not yet a 10/10 reference demo because its central scientific story is
more confident than its evidence currently supports. The highest-priority work
is not more visual polish. It is to make the leakage model faithful to the cited
paper and to make every plotted/reported unit auditable. Once those are fixed,
the experience should be shortened and reorganized around one decisive
experiment.

My current assessment is **7/10 as a published research explainer** and **9/10
as a small, inspectable ISD implementation**. The difference is claim fidelity,
not whether the solvers are real.

## Audit basis

Reviewed on 2026-07-20 against the repository source, the current ePrint landing
page and abstract (revision dated 2026-07-13), and the rendered production build.
Local validation completed successfully:

- `npm test`: 47/47 tests passed across five files;
- `npm run build`: strict TypeScript and the Vite production build passed;
- `npm run test:a11y`: both dark- and light-theme WCAG A/AA axe scans passed;
- rendered inspection: nine content cards and a document height of about 7,300
  CSS pixels at a 1440-by-900 desktop viewport.

The paper PDF itself was blocked by ePrint's browser challenge during this
review. Therefore, finding 1 is deliberately framed as a **source-fidelity
blocker requiring formal-definition verification**, not as a claim that the
coordinate oracle can never be derived as a specialization. The mismatch with
the published abstract and the repository's lack of that derivation are both
confirmed.

## P0: Fix before calling it a gold-standard Hint-ISD demo

### 1. Implement the paper's hint model, or relabel this as a support-leakage adaptation

**Classification: source-fidelity blocker.**

The page currently defines a perfect hint as an exact secret coordinate:

- [src/main.ts](src/main.ts#L429-L454) says a perfect hint "leaks one exact
  coordinate of the secret error" and calls this the Cayrel et al. fault model.
- [src/sdp/types.ts](src/sdp/types.ts#L20-L42) represents a perfect hint as
  `(index, value)` and makes the same attribution in its API documentation.
- [src/sdp/isd.ts](src/sdp/isd.ts#L40-L68) consumes such a hint by deleting that
  column, XORing it out of the syndrome when the leaked value is one, and
  decrementing the residual weight.

That reduction is internally coherent, and the real solvers genuinely run on
the resulting residual instance. It is also a very strong leakage oracle.
However, the [published abstract](https://eprint.iacr.org/2026/341) describes
the Cayrel et al. antecedent "perfect hints" as **syndrome entries revealed over
the integers**, with noisy versions providing approximate hints. An integer
syndrome observation and a disclosed `e_i` are not the same observable on their
face, and the repository provides no derivation showing that its oracle is an
equivalent specialization.

This matters because the demo currently attributes several conclusions to the
paper while deriving them from direct support disclosure:

- every slider step is guaranteed informative;
- each step removes exactly one error position;
- the residual instance is simply $(n-h,r,w-h)$;
- full recovery takes exactly $w$ support reveals;
- approximate hints are modeled as a separate block-weight meter rather than a
  noisy observation of the same underlying hint channel.

For a 10/10 result, choose one of two honest paths:

1. **Faithful path:** implement the paper's formal perfect/approximate hint
  observations and the corresponding soft-decision ISD scoring/reordering,
  after checking the formal definitions in the pinned revision. Reproduce at
  least one small result or threshold from the paper.
2. **Adaptation path:** keep the exact-coordinate oracle, but rename it
   everywhere to **support-coordinate leakage** (or "oracle support reveals"),
   say explicitly that it is a stronger pedagogical specialization, and stop
  presenting $h=w$ as the paper's general bound.

Do not resolve this with a footnote. It controls the title, threat model,
slider semantics, formulas, scheme comparison, and headline conclusion.

**Acceptance test:** a cryptographer can map every UI control to a definition or
algorithm in the cited paper, or the UI labels the departure at the point of
interaction and in the hero.

### 2. Define one work unit and use it consistently

**Classification: confirmed correctness defect in labels and overlays.**

This is an accounting/presentation defect, not evidence that either decoder
returns an incorrect solution; recovery is independently verified against the
syndrome.

The page currently presents model and measurement as if they share one exact
unit, but three incompatible conventions are mixed:

- [src/sdp/workfactor.ts](src/sdp/workfactor.ts#L48-L55) models the chart's
  elimination cost as $r^2$ **row-combines** through `elimOps`.
- [src/sdp/workfactor.ts](src/sdp/workfactor.ts#L139-L147) separately models a
  floor of $r^3$ **bit operations** through `polyFloorBits`.
- [src/sdp/gf2.ts](src/sdp/gf2.ts#L66-L79) defines the measured counter as
  row-combines, but [src/sdp/stern.ts](src/sdp/stern.ts#L197-L242) also adds one
  for every list entry and collision candidate. Those are heterogeneous events,
  not all GF(2) row-combines.

The UI then calls the attack result "GF(2) ops," the chart "log2 GF(2)
operations," and the reference says both algorithms and measured dots use the
same row-combine unit. The solvers are real, but that last comparability claim is
not yet established.

Adopt an explicit operation ledger, for example:

| Counter | Meaning |
| --- | --- |
| `rowXorBits` | number of bits XORed during elimination |
| `listEntries` | Stern list entries generated |
| `hashLookups` | Stern table probes |
| `candidateChecks` | full weight/syndrome candidate checks |
| `wallMs` | elapsed browser time, shown only as an implementation measurement |

Then either:

- convert the ledger to a documented bit-operation estimate with declared
  weights; or
- plot separate measured quantities and avoid claiming one scalar is a
  canonical cryptanalytic work factor.

Also make the plotted floor identical to the floor described in the formula.
For the main $r=24$ instance, the chart uses
$\log_2(24^2)=9.17$ bits, while the reference text says "$r^2$ row-combines"
but displays `polyFloorBits(24)`, or $\log_2(24^3)=13.75$ bits
([src/main.ts](src/main.ts#L469-L483),
[src/main.ts](src/main.ts#L704-L720)). At full hints both solvers return
`work = 0` ([src/sdp/isd.ts](src/sdp/isd.ts#L134-L141),
[src/sdp/stern.ts](src/sdp/stern.ts#L159-L166)); the plotted measured point is
therefore 0 bits while the model remains at 9.17 bits because
`measureAndStore` clamps zero to one before taking the logarithm
([src/main.ts](src/main.ts#L76-L82)). The overlay is comparing different
computations at the most important endpoint.

**Acceptance test:** given one run, a reader can reconstruct the displayed total
from named counters, and model-versus-measurement residuals are meaningful at
every hint count, including `h = w`.

### 3. Replace the current Stern model with a cited, testable estimator

**Classification: evidence gap, not a demonstrated solver bug.**

The implementation is a genuine meet-in-the-middle Stern-style search. The
estimator is still a simplified teaching model, and the page presents it too
strongly as the expected work of that exact implementation.

The current estimator consists of a compact expected-iterations denominator and
an elimination/list/collision term
([src/sdp/workfactor.ts](src/sdp/workfactor.ts#L62-L89)). Its optimizer searches
only $p\leq3$ ([src/sdp/workfactor.ts](src/sdp/workfactor.ts#L96-L117)). That can
be a reasonable browser-scale teaching estimator, but there is no empirical
calibration test for predicted versus observed work. Existing model tests prove
ordering and monotonicity, while the solver test proves that four measured Stern
runs are cheaper than four Prange runs; neither establishes that dots should
"land near" their curves ([src/sdp/workfactor.test.ts](src/sdp/workfactor.test.ts#L67-L87),
[src/sdp/stern.test.ts](src/sdp/stern.test.ts#L38-L50)).

For gold-standard status:

- state the precise Stern variant;
- derive the estimator next to the implementation or cite the exact equation;
- document all omitted terms;
- calibrate expected iterations and each ledger component over enough seeds;
- show confidence intervals or quantiles, not only a four-run mean;
- test that empirical estimates converge within a declared tolerance on a
  matrix of small parameter sets.

**Acceptance test:** the chart can show `measured / predicted` for each point,
and the residuals do not have an unexplained algorithm- or hint-dependent bias.

### 4. Rebuild the McEliece-versus-HQC comparison from primary specifications

**Classification: source/provenance gap plus an unrepresentative toy design.**

The current comparison reduces fragility to "hints to polynomial = w" and uses
toy weights 6 versus 3. That conclusion follows automatically from the demo's
support-reveal oracle; it does not independently reproduce the paper's bound.
The copy also calls 64 errors in length 3488 a "big fraction" and makes the
McEliece toy weight `6/22 = 27.3%`, while the quoted real ratio is
`64/3488 = 1.83%`. The HQC toy is `3/26 = 11.5%`, versus `66/17669 = 0.37%` for
the displayed real values
([src/sdp/schemes.ts](src/sdp/schemes.ts#L39-L62)). The toys preserve ordering
but not scale or relative shape. The HQC value also needs to identify the exact
scheme vector and reduction whose weight is being quoted; "error weight" alone
is not sufficient provenance for a scheme with several weighted vectors.

Rebuild this panel as a sourced comparison table:

- exact parameter-set version and primary URL;
- the precise secret/error vector to which each weight refers;
- `n`, relevant weight(s), relative weight, and security target;
- the paper's actual bound or simulated threshold under the same hint model;
- a clear separation between real-parameter estimates and runnable toy data.

Avoid the unqualified badges "fragile" and "resistant." They read as overall
scheme-security judgments when the intended statement is conditional leakage
sensitivity under one model. Prefer labels such as "fewer hints in this model"
and "more hints in this model."

**Acceptance test:** changing the toy weights cannot change the stated
real-scheme conclusion, because that conclusion is computed from sourced real
parameters and the cited model rather than inferred from the toys.

## P1: Turn the page into one memorable experiment

### 5. Put the result in the first viewport

**Classification: product-design improvement.**

At desktop size the document contains nine cards and is roughly 7,300 px tall.
The first actual run button appears only after the hero, introductory card, and
the full 24-by-48 matrix exercise. The central chart is another card later; that
sequence is explicit in the mount order
([src/main.ts](src/main.ts#L810-L821)).

The best first screen would combine:

- a one-sentence threat model;
- algorithm segmented control;
- hint control;
- run button;
- residual `(n, w)`;
- model curve, measured point, uncertainty, and verification result;
- a compact "real / modeled / quoted" provenance key.

Start with a guided preset that runs both algorithms at `h = 0`, a midpoint,
and the collapse threshold. Let "inspect the matrix," derivation, FAQ, and scope
expand below. The current matrix is valuable evidence, but it should support the
experiment rather than delay it.

**Acceptance test:** a first-time visitor can state the independent variable,
dependent variable, observed result, and caveat after one interaction and
without reading the README.

### 6. Make runs comparative, not ephemeral

**Classification: experiment-design improvement.**

Selecting the other algorithm replaces the prior result. A learner must
remember numbers while scrolling between the attack and chart. Turn this into a
small experiment table with paired rows:

| Hints | Residual | Algorithm | Median work | Spread | Verified |
| --- | --- | --- | --- | --- | --- |

Add "Run both," seed/trial controls under an advanced disclosure, reset, and a
downloadable JSON/CSV record containing parameters, seeds, counters, model
version, and results. Keep deterministic defaults for reproducibility.

The current aggregate is an arithmetic mean over exactly four fixed seeds
([src/main.ts](src/main.ts#L71-L82)). Four trials are too few to characterize a
randomized search with high variance. Show the sample mean when comparing to an
expected-mean model, but add a median and interval (for example p10-p90) so the
distribution is not hidden.

### 7. Stop revealing the secret before the attack proves anything

**Classification: pedagogical-viewpoint defect.**

The attack panel renders every true support bit as `1` before it is leaked; only
the lock icon changes ([src/main.ts](src/main.ts#L360-L371)). That makes the
"secret error" visually public and weakens the mental model of what the attacker
knows. It also makes the support-only nature of the slider easy to miss.

Render unknown coordinates as `?` from the attacker's view. Provide a deliberate
"show planted truth" overlay for teaching/debugging, visually distinct from
attacker knowledge. Keep the primer's reveal action, but do not carry that
omniscient view into the attack by default.

### 8. Replace prose repetition with progressive disclosure

**Classification: information-architecture improvement.**

The same caveats recur in the hero, intro, attack footnote, chart copy,
reference, FAQ, caveats card, and README. Repetition makes the page longer
without making provenance easier to inspect.

Use compact labels next to claims:

- **Executed:** decoder result and verification;
- **Estimated:** analytical work model;
- **Observed:** timed/counted trial aggregate;
- **Quoted:** real-world parameter fact;
- **Adapted:** behavior intentionally different from the paper.

Each label should open one shared methodology drawer. This will reduce copy
while improving epistemic clarity.

## P1: Verification expected of a reference implementation

### 9. Add behavior tests, not only axe scans

**Classification: test-coverage gap.**

The existing browser suite drives interactions but asserts mainly visibility
before running axe ([e2e/a11y.spec.ts](e2e/a11y.spec.ts#L43-L106)). Add
Playwright assertions for the scientific contract:

- both algorithm selections execute the intended solver;
- changing either synchronized slider updates both sliders and the residual;
- a run adds the correct measured series and never the other series;
- recovered vectors independently satisfy `H * e = s` and the weight bound;
- full support leakage follows the documented setup-cost convention;
- model/measurement/provenance labels remain visible in every result state;
- malformed or impossible hint sets fail visibly rather than creating negative
  residual weights;
- keyboard-only completion works at desktop and mobile widths;
- no horizontal overflow or clipped chart/control labels at 320, 375, 768,
  1280, and 1440 CSS pixels.

Add screenshot regression for the opening experiment and its solved state.
The current axe gate is valuable, but axe cannot establish scientific
correctness, responsive composition, focus order quality, or absence of text
overlap.

### 10. Add adversarial unit and property tests

**Classification: robustness gap; no failure is asserted for valid demo input.**

The 47 passing tests establish useful happy-path confidence. Gold-standard
coverage should also include:

- invalid, duplicate, contradictory, negative, and out-of-range hints;
- a leaked `1` count greater than `w`;
- rank-deficient matrices and non-full-rank systematic conversions;
- `r > n`, `r < w`, `w > n`, zero dimensions, and malformed row lengths;
- Stern's `p = 0` branch and every allowed `(p, l)` boundary;
- exhaustive tiny-instance comparison against brute-force minimum-weight
  decoding;
- property tests for reduction/reconstruction equivalence;
- fixed known-answer vectors from an external reference, not only instances
  generated by the same code under test;
- model-domain validation that rejects invalid parameters instead of returning
  plausible finite values.

Do not use "harder takes more iterations for one seed" as a statistical
contract ([src/sdp/isd.test.ts](src/sdp/isd.test.ts#L23-L34)). Replace it with a
distributional test over fixed seeds and a declared effect size, or test an
exact probability/model identity on exhaustive tiny instances.

### 11. Make the paper-to-code trace explicit

**Classification: reproducibility/provenance improvement.**

Add a short methodology document that maps:

| Claim | Source definition/equation | Code | Test | UI |
| --- | --- | --- | --- | --- |

Pin paper version/date because ePrint revisions can change equations. Record
the exact primary specification versions for both schemes. Include a
machine-readable experiment manifest in the app build so screenshots and CSVs
identify the model revision that generated them.

## P2: Product and accessibility polish

### 12. Improve chart inspection

**Classification: accessibility and data-inspection improvement.**

The SVG is a good compact overview but lacks direct point values and visual
grid support. Add keyboard-focusable points, tooltips or an adjacent data table,
direct line labels, uncertainty bands, and a model-minus-observed residual view.
Do not make the legend `aria-hidden` as it is now
([src/main.ts](src/main.ts#L518-L524)); provide equivalent persistent semantics,
not only a changing prose summary for the current point.

Use mathematically precise axis text. If the quantity is a weighted estimate,
say so rather than "GF(2) ops." If runs can return zero setup work, define how
zero is displayed on a log scale.

### 13. Tighten interaction semantics

**Classification: interaction-polish improvement.**

- Use a true segmented control presentation for the two algorithms.
- Add current numeric values as visible outputs next to every range input.
- Give range inputs useful keyboard increments and endpoint labels.
- Disable the run button while a batch is running and announce progress.
- Preserve separate last results for Prange and Stern.
- Replace emoji-only state imagery with the existing text plus stable icons;
  emoji rendering varies by platform and changes visual weight.
- Make matrix/candidate exercises optional on narrow screens rather than
  presenting 48 tiny controls as an early primary interaction.

### 14. Finish publication metadata and maintenance hygiene

**Classification: confirmed documentation drift plus publication polish.**

- Add an Open Graph preview image and use a large-image social card.
- Update the README's stale "46 tests" claim to 47, or generate the count
  ([README.md](README.md#L120-L127)).
- Remove claims such as "well under a frame" unless CI measures and enforces
  them on named hardware/browser conditions
  ([README.md](README.md#L145-L153)).
- Reconcile `gf2.ts`'s comment saying sizes are `n <= ~32` with the main
  `n = 48` instance ([src/sdp/gf2.ts](src/sdp/gf2.ts#L1-L9),
  [src/main.ts](src/main.ts#L22-L29)).
- Cite primary URLs next to real parameter facts in the UI, not only generic
  papers in a later disclosure.
- Add licenses/attribution for the demo and its paper-derived material if the
  repository is meant to be reused as a reference.

## What is already gold-standard material

These parts should be preserved:

- Both Prange and Stern perform genuine searches rather than animating a
  precomputed answer.
- Every successful result is checked against the original syndrome equation.
- The implementation is small enough to inspect and deterministically seeded.
- Perfect-support reduction is shared by both decoders, avoiding divergent demo
  logic.
- The page repeatedly distinguishes toy execution from quoted real parameters.
- The approximate panel is visibly labeled as modeled rather than executed.
- Strict TypeScript, unit tests, production build, and two-theme WCAG A/AA axe
  scans all pass.
- The page explicitly says that recovering `e` is not a full key recovery or a
  decryption forgery.

## A practical route to 10/10

### Milestone 1: scientific contract

1. Decide faithful paper implementation versus explicitly labeled support-leak
   adaptation.
2. Write the paper-to-code claim matrix.
3. Define the operation ledger and one model unit.
4. Source and recompute the real-scheme comparison.

### Milestone 2: decisive experiment

1. Merge controls, chart, measured results, and verification above the fold.
2. Add paired multi-trial runs, distributions, and export.
3. Separate attacker knowledge from planted truth.
4. Move derivations and matrix inspection into progressive disclosure.

### Milestone 3: reference-grade verification

1. Add exhaustive tiny-instance and property tests.
2. Add browser behavior, responsive, keyboard, and visual regression tests.
3. Calibrate model residuals across a parameter grid.
4. Pin source/model versions in exported experiment records.

## Definition of done

I would call the demo 10/10 when all of the following are true:

- The hint shown in the UI is formally the hint defined in the cited work, or
  the adaptation is impossible to mistake for that definition.
- All headline conclusions are reproduced from the declared model rather than
  implied by a stronger oracle or hand-shaped toys.
- Every measured dot has reproducible seeds, enough trials, uncertainty, and a
  counter ledger in the same declared unit as its comparison curve.
- A first-time learner reaches and understands the core experiment in the first
  viewport.
- Real-scheme facts are versioned, primary-sourced, and conditional language
  replaces overall security labels.
- Unit, property, browser behavior, accessibility, responsive, and visual tests
  protect the scientific and interaction contracts.

That would make this more than an impressive demo. It would make it a compact,
reproducible research explainer whose strongest claims are the easiest parts to
audit.