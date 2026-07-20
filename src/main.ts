import './styles.css';
import { el, clear, $ } from './ui/dom';
import { drawChart, type Series } from './ui/chart';
import { bitstring, fmtBits, bitsToWork } from './ui/format';
import { matVec, weight, type Vec } from './sdp/gf2';
import { makeInstance } from './sdp/instance';
import { runAttack } from './sdp/isd';
import { runStern } from './sdp/stern';
import type { AttackResult, Instance, PerfectHint } from './sdp/types';
import {
  searchExponentBits,
  polyFloorBits,
  elimOps,
  prangeWorkBits,
  sternWorkBits,
  bestSternParams,
  approxGainBits,
  hintsToPolynomial,
} from './sdp/workfactor';
import { SCHEMES, schemeContrast } from './sdp/schemes';

// ---------------------------------------------------------------------------
// The single interactive SDP instance the main panels attack. Sized up to
// n=48, w=10 (an honestly-labelled toy) so Prange visibly struggles where Stern
// does not — the comparison only teaches if the gap is real. Still a genuine
// H·e = s instance over F_2, decoded live in the browser by both real solvers.
// ---------------------------------------------------------------------------
const MAIN: Instance = makeInstance({ n: 48, k: 24, w: 10, seed: 0x5a1d });
const SUPPORT: number[] = Array.from(MAIN.e).flatMap((b, i) => (b ? [i] : []));

type Algo = 'prange' | 'stern';

interface State {
  hints: number; // perfect (support) hints revealed: 0..w
  algo: Algo;
}
const state: State = { hints: 0, algo: 'prange' };

// Measured work (log2 row-combine ops) from real runs, per algorithm, keyed by
// hint count — accumulates as the learner runs the attack at different hints.
const measured: Record<Algo, Map<number, number>> = { prange: new Map(), stern: new Map() };

const subscribers: ((s: State) => void)[] = [];
function subscribe(fn: (s: State) => void) {
  subscribers.push(fn);
  fn(state);
}
function notify() {
  subscribers.forEach((fn) => fn(state));
}
function setHints(h: number) {
  state.hints = Math.max(0, Math.min(MAIN.w, h));
  notify();
}
function setAlgo(a: Algo) {
  state.algo = a;
  notify();
}

/** The perfect hints for the first `count` support coordinates (informative faults). */
function hintsForCount(count: number): PerfectHint[] {
  return SUPPORT.slice(0, count).map((index) => ({ kind: 'perfect', index, value: 1 }));
}

/** Run the selected real solver once against the real instance at `count` hints. */
function runSolver(algo: Algo, count: number, seed: number): AttackResult {
  const hints = hintsForCount(count);
  return algo === 'stern' ? runStern(MAIN, hints, { seed }) : runAttack(MAIN, hints, { seed });
}

/**
 * Average the measured work (log2 ops) of a few genuine runs of `algo` at
 * `count` hints — genuine, just stabilised against the geometric variance of a
 * single randomized run. Stores the point so the chart can plot it.
 */
function measureAndStore(algo: Algo, count: number): number {
  let total = 0;
  const trials = 4;
  for (let seed = 1; seed <= trials; seed++) total += runSolver(algo, count, seed).work;
  const bits = Math.log2(Math.max(1, total / trials));
  measured[algo].set(count, bits);
  return bits;
}

interface WorkPoint {
  hints: number;
  n: number;
  w: number;
  prangeBits: number;
  sternBits: number;
  polynomial: boolean;
}

/** Both algorithms' modelled work-factor curves as support hints are revealed. */
function workCurves(): WorkPoint[] {
  const pts: WorkPoint[] = [];
  for (let h = 0; h <= MAIN.w; h++) {
    const n = MAIN.n - h;
    const w = MAIN.w - h;
    const inp = { n, r: MAIN.r, w };
    pts.push({
      hints: h,
      n,
      w,
      prangeBits: prangeWorkBits(inp),
      sternBits: sternWorkBits(inp),
      polynomial: searchExponentBits(inp) <= 0.5,
    });
  }
  return pts;
}

const ALGO_LABEL: Record<Algo, string> = { prange: 'Prange', stern: 'Stern' };

// ===========================================================================
// Section builders
// ===========================================================================

function sectionIntro(): HTMLElement {
  return el('section', { class: 'card card-intro', 'aria-labelledby': 'intro-h' }, [
    el('p', { class: 'eyebrow' }, ['Start here']),
    el('h2', { id: 'intro-h' }, ['What is this, and why should you care?']),
    el('p', { class: 'lede' }, [
      'Some of the post-quantum encryption the world is standardising — Classic McEliece, HQC — is safe only because one specific puzzle is hard to solve: given a secret pattern of errors scrambled into a short “syndrome,” find the errors. That puzzle is called ',
      el('strong', {}, ['syndrome decoding']),
      ', and with no extra information the best known attack takes exponential time.',
    ]),
    el('p', { class: 'prose' }, [
      'But attackers do not always start from zero. A glitched chip or a power-consumption trace can ',
      el('strong', {}, ['leak a hint']),
      ' — one true coordinate of the secret, or a noisy guess at how many errors sit in a region. This demo lets you feed the real attacker those hints, one at a time, and watch its workload fall off a cliff: from exponential (a wall) toward polynomial (instant). Everything you attack below is real F₂ linear algebra — no faked math.',
    ]),
  ]);
}

function sectionPrimer(): HTMLElement {
  // Concrete SDP instance + a compute-both-sides-and-compare interaction.
  const candidate: Vec = new Uint8Array(MAIN.n);
  let reveal = false;

  const matrixRegion = el('div', {
    class: 'matrix-region',
    role: 'group',
    tabindex: '0',
    'aria-label': `Parity-check matrix H, ${MAIN.r} rows by ${MAIN.n} columns, over F2`,
  });
  matrixRegion.append(renderMatrix(MAIN));

  const bitRow = el('div', { class: 'bit-row', 'aria-label': 'Candidate error vector — click a bit to flip it' });
  const cmp = el('p', { class: 'readout-line', role: 'status', 'aria-live': 'polite' });

  function refresh() {
    clear(bitRow);
    for (let i = 0; i < MAIN.n; i++) {
      const set = candidate[i] === 1;
      const isSupport = reveal && MAIN.e[i] === 1;
      const b = el(
        'button',
        {
          type: 'button',
          class: `bit${set ? ' set' : ''}${isSupport ? ' support' : ''}`,
          'aria-pressed': String(set),
          'aria-label': `Position ${i}, currently ${set ? '1' : '0'}${isSupport ? ', part of the true error' : ''}`,
        },
        [el('span', { class: 'idx' }, [String(i)]), set ? '1' : '0'],
      );
      b.addEventListener('click', () => {
        candidate[i] = candidate[i] ? 0 : 1;
        refresh();
      });
      bitRow.append(b);
    }
    const he = matVec(MAIN.H, candidate);
    const match = he.every((x, i) => x === MAIN.s[i]);
    const wt = weight(candidate);
    clear(cmp);
    cmp.append(
      el('span', { class: 'mono' }, [`H·e = ${bitstring(he)}`]),
      document.createTextNode('   vs   '),
      el('span', { class: 'mono' }, [`s = ${bitstring(MAIN.s)}`]),
      document.createTextNode('   '),
      match
        ? el('span', { class: 'cmp-pass' }, [`✓ match — weight ${wt}${wt <= MAIN.w ? ' ≤ ' + MAIN.w + ', a valid solution' : ', but too heavy'}`])
        : el('span', { class: 'cmp-fail' }, ['✗ no match — keep trying']),
    );
  }

  const clearBtn = el('button', { type: 'button', class: 'preset' }, ['Clear']);
  clearBtn.addEventListener('click', () => {
    candidate.fill(0);
    refresh();
  });
  const revealBtn = el('button', { type: 'button', class: 'preset' }, ['Reveal the true error']);
  revealBtn.addEventListener('click', () => {
    reveal = !reveal;
    revealBtn.textContent = reveal ? 'Hide the true error' : 'Reveal the true error';
    if (reveal) candidate.set(MAIN.e);
    refresh();
  });

  refresh();

  return el('section', { class: 'card', 'aria-labelledby': 'primer-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['1']), 'See the problem']),
    el('h2', { id: 'primer-h' }, ['The syndrome-decoding instance, for real']),
    el('p', { class: 'lede' }, [
      'Here is a genuine instance over F₂: a public parity-check matrix ',
      el('code', {}, ['H']),
      ` (${MAIN.r}×${MAIN.n}) and a syndrome `,
      el('code', {}, ['s']),
      '. Somewhere there is a hidden error vector ',
      el('code', {}, ['e']),
      ` of weight ${MAIN.w} with `,
      el('code', {}, ['H·e = s']),
      '. Every syndrome bit is just the XOR (parity) of the error bits its row of H touches.',
    ]),
    el('h3', {}, ['H — the public rulebook']),
    matrixRegion,
    el('p', { class: 'footnote' }, [
      'Each column is one code position; a shaded ',
      el('code', {}, ['1']),
      ' means that position feeds that parity check.',
    ]),
    el('h3', {}, ['Try to decode it by hand']),
    el('p', { class: 'prose' }, [
      'Flip positions to build a candidate ',
      el('code', {}, ['e']),
      ', and the demo computes ',
      el('code', {}, ['H·e']),
      ' and compares it, bit for bit, against ',
      el('code', {}, ['s']),
      `. Finding the weight-${MAIN.w} match by guessing is exactly the hard search the attacker faces — go ahead and feel how hard it is.`,
    ]),
    bitRow,
    el('div', { class: 'btn-row' }, [clearBtn, revealBtn]),
    cmp,
  ]);
}

function algorithmSelector(): HTMLElement {
  // A real selector: it chooses which genuine solver runs against the real
  // instance and the real hint framework — not a display flag.
  const fieldset = el('fieldset', { class: 'algo-select' });
  const legend = el('legend', {}, ['Attack algorithm']);
  fieldset.append(legend);
  (['prange', 'stern'] as Algo[]).forEach((a) => {
    const id = `algo-${a}`;
    const input = el('input', {
      type: 'radio',
      name: 'algo',
      id,
      value: a,
    }) as HTMLInputElement;
    input.checked = state.algo === a;
    input.addEventListener('change', () => {
      if (input.checked) setAlgo(a);
    });
    const label = el('label', { for: id, class: 'algo-option' }, [
      input,
      el('span', { class: 'algo-name' }, [ALGO_LABEL[a]]),
      el('span', { class: 'algo-tag' }, [
        a === 'prange' ? 'baseline: re-randomise & hope' : 'collision search on the info set',
      ]),
    ]);
    fieldset.append(label);
  });
  subscribe((s) => {
    for (const a of ['prange', 'stern'] as Algo[]) {
      (fieldset.querySelector(`#algo-${a}`) as HTMLInputElement).checked = s.algo === a;
    }
  });
  return fieldset;
}

function sectionAttack(): HTMLElement {
  const slider = el('input', {
    type: 'range',
    id: 'hint-slider',
    min: '0',
    max: String(MAIN.w),
    step: '1',
    value: '0',
    'aria-describedby': 'hint-readout',
  }) as HTMLInputElement;

  const readout = el('p', { class: 'readout-line', id: 'hint-readout', role: 'status', 'aria-live': 'polite' });
  const errorRow = el('div', {
    class: 'bit-row',
    role: 'group',
    'aria-label': 'The secret error vector; revealed coordinates are marked known',
  });
  const meter = el('div', { class: 'meter', role: 'status', 'aria-live': 'polite' });
  const result = el('div', { class: 'result-region', role: 'status', 'aria-live': 'polite' });

  slider.addEventListener('input', () => setHints(Number(slider.value)));

  const runBtn = el('button', { type: 'button', class: 'btn btn-accent' }, ['Run the real ISD attack']);
  runBtn.addEventListener('click', () => runAndShow());

  function runAndShow() {
    const algo = state.algo;
    const res = runSolver(algo, state.hints, 0x1d ^ (state.hints + (algo === 'stern' ? 1000 : 0)));
    // Also record a stabilised measured point so the chart's dot updates.
    measureAndStore(algo, state.hints);
    notify();

    clear(result);
    if (res.solved && res.recovered) {
      const ok = matVec(MAIN.H, res.recovered).every((b, i) => b === MAIN.s[i]);
      const sternParams = 'params' in res ? (res as { params: { p: number; l: number } }).params : null;
      // A successful recovery is an ALARM: the attacker won for this instance.
      result.append(
        el('div', { class: 'meter' }, [
          el('span', { class: 'meter-badge state-broken' }, ['💥', `${ALGO_LABEL[algo]} recovered e`]),
          el('p', { class: 'meter-text' }, [
            el('strong', {}, [`Security broken for this instance.`]),
            document.createTextNode(
              ` ${res.iterations.toLocaleString()} permutation${res.iterations === 1 ? '' : 's'}, ` +
                `${res.work.toLocaleString()} GF(2) ops (${bitsToWork(Math.log2(Math.max(1, res.work)))}).` +
                (sternParams && sternParams.p > 0
                  ? ` Stern ran a birthday search with p=${sternParams.p}, ℓ=${sternParams.l}.`
                  : ''),
            ),
          ]),
        ]),
        el('p', { class: 'readout-line mono' }, [`e = ${bitstring(res.recovered)}`]),
        el('p', { class: ok ? 'cmp-pass' : 'cmp-fail' }, [
          ok ? '✓ verified: H·e = s' : '✗ verification FAILED',
        ]),
        el('p', { class: 'footnote' }, [
          `Residual instance the ${state.hints} hint${state.hints === 1 ? '' : 's'} left: length n=${res.reduced.n}, weight w=${res.reduced.w}. `,
          'This recovers the error vector e — not a decryption forgery.',
        ]),
      );
    } else {
      result.append(
        el('div', { class: 'meter' }, [
          el('span', { class: 'meter-badge state-hard' }, ['🛡️', 'no solution within the cap']),
          el('p', { class: 'meter-text' }, [
            `${ALGO_LABEL[algo]} exhausted its iteration cap without a hit — leak more hints and try again.`,
          ]),
        ]),
      );
    }
  }

  function update(s: State) {
    slider.value = String(s.hints);
    const cur = workCurves()[s.hints];

    clear(readout);
    readout.append(
      el('strong', {}, [`${s.hints} of ${MAIN.w} perfect hints`]),
      document.createTextNode(
        ` — residual weight ${cur.w}. Modelled total work: Prange ${bitsToWork(cur.prangeBits)} ops, Stern ${bitsToWork(cur.sternBits)} ops.`,
      ),
    );

    // Error vector display.
    clear(errorRow);
    for (let i = 0; i < MAIN.n; i++) {
      const isSupport = MAIN.e[i] === 1;
      const known = isSupport && SUPPORT.indexOf(i) < s.hints;
      const cell = el(
        'span',
        {
          class: `bit${isSupport ? ' set support' : ''}${known ? ' hint-known' : ''}`,
          'aria-label': `Position ${i}: ${isSupport ? 'error bit 1' : 'zero'}${known ? ', leaked by a hint' : ''}`,
        },
        [el('span', { class: 'idx' }, [String(i)]), known ? '🔓' : isSupport ? '1' : '0'],
      );
      errorRow.append(cell);
    }

    // Meter — colour tracks security integrity (icon + text + colour, never colour alone).
    clear(meter);
    let cls: string, icon: string, label: string, note: string;
    if (cur.polynomial) {
      cls = 'state-broken';
      icon = '⛔';
      label = 'BROKEN — polynomial time';
      note = 'The support is fully known; the residual search is trivial for either algorithm. Security has collapsed.';
    } else if (s.hints > 0) {
      cls = 'state-draining';
      icon = '⚠️';
      label = 'DRAINING';
      note = 'Each hint removes a support coordinate; both algorithms’ work factors are falling.';
    } else {
      cls = 'state-hard';
      icon = '🛡️';
      label = 'HARD — exponential';
      note = 'No hints yet; the attacker faces the full exponential search.';
    }
    meter.append(
      el('span', { class: `meter-badge ${cls}` }, [icon, label]),
      el('p', { class: 'meter-text' }, [note]),
    );
  }
  subscribe(update);

  const sternExplainer = el('details', {}, [
    el('summary', {}, ['How Stern differs from Prange (the mechanism)']),
    el('div', { class: 'prose' }, [
      el('p', {}, [
        el('strong', {}, ['Newcomer version:']),
        ' Prange guesses which columns hold the error and, if it guesses wrong, throws the work away and re-randomises. Stern is a smarter, faster search — it reuses each expensive setup to test many candidate errors at once.',
      ]),
      el('p', {}, [
        el('strong', {}, ['Expert version:']),
        ' after row-reducing H to systematic form, Stern splits the information set into halves X and Y and looks for an error with exactly ',
        el('code', {}, ['p']),
        ' ones in each half and ',
        el('em', {}, ['zero']),
        ' ones in a chosen ',
        el('code', {}, ['ℓ']),
        '-row window. It builds the X-side candidates, indexes them by their window projection, and ',
        el('strong', {}, ['meets in the middle']),
        ' from the Y side — a birthday collision that discards most pairs cheaply, amortising the one Gaussian elimination over C(k/2, p)² candidates. That is why Stern needs far fewer permutations. ',
        el('span', { class: 'muted' }, ['(MMT and BJMM refine this middle step further; they are named here, not implemented.)']),
      ]),
    ]),
  ]);

  return el('section', { class: 'card card-primary', 'aria-labelledby': 'attack-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['2']), 'Break it yourself']),
    el('h2', { id: 'attack-h' }, ['Pick an algorithm, feed it hints, run it for real']),
    el('p', { class: 'lede' }, [
      'A ',
      el('strong', {}, ['perfect hint']),
      ' (the fault model of Cayrel et al., Eurocrypt ’21) leaks one exact coordinate of the secret error. Choose which real solver to run — ',
      el('strong', {}, ['Prange']),
      ' (', el('code', {}, ['src/sdp/isd.ts']), ') or ',
      el('strong', {}, ['Stern']),
      ' (', el('code', {}, ['src/sdp/stern.ts']), ') — leak coordinates with the slider, then press ',
      el('strong', {}, ['Run']),
      '. Both decode the same residual instance through the same hint framework and report the work they actually did.',
    ]),
    algorithmSelector(),
    sternExplainer,
    el('div', { class: 'control' }, [
      el('label', { for: 'hint-slider' }, ['Perfect hints leaked (coordinates of the true error)']),
      slider,
      readout,
    ]),
    el('h3', {}, ['The secret error e — 🔓 marks a leaked coordinate']),
    errorRow,
    meter,
    el('div', { class: 'btn-row' }, [runBtn]),
    result,
    el('p', { class: 'footnote' }, [
      'The slider leaks the ',
      el('em', {}, ['informative']),
      ` case — coordinates that are actually part of the support. Revealing the whole weight-${MAIN.w} support (${MAIN.w} hints) leaves nothing to search, which is the crisp `,
      el('strong', {}, ['hint-count-to-polynomial bound: ≈ w hints']),
      '. Faults that land on zeros help less; the paper handles the general case.',
    ]),
  ]);
}

function sectionCurve(): HTMLElement {
  const chartHost = el('figure', { class: 'chart-wrap', role: 'group', 'aria-label': 'Work-factor curves' });
  const chartCap = el('figcaption', { class: 'chart-cap', id: 'work-chart-cap' }, [
    'Total attack work (log₂ GF(2) operations) versus perfect hints leaked, for both real algorithms. The upper line is Prange, the lower line is Stern — the vertical gap between them is the algorithm advantage, and both fall toward the polynomial floor (dashed) as hints add up. Dots are the average of real runs you launched; the vertical line marks the current hint count.',
  ]);
  const chartDesc = el('p', { class: 'visually-hidden', id: 'work-chart-desc', role: 'status', 'aria-live': 'polite' });

  function update(s: State) {
    const points = workCurves();
    const floor = Math.log2(elimOps(MAIN.r));
    const prange: Series = { cls: `curve prange${s.algo === 'prange' ? ' sel' : ''}`, points: points.map((p) => [p.hints, p.prangeBits]) };
    const stern: Series = { cls: `curve stern${s.algo === 'stern' ? ' sel' : ''}`, points: points.map((p) => [p.hints, p.sternBits]) };

    const markers = [
      ...[...measured.prange].map(([h, b]) => ({ x: h, y: b, cls: 'measured measured-prange' })),
      ...[...measured.stern].map(([h, b]) => ({ x: h, y: b, cls: 'measured measured-stern' })),
    ];

    clear(chartHost);
    chartHost.append(
      drawChart({
        xMax: MAIN.w,
        yMax: points[0].prangeBits,
        xLabel: 'perfect hints leaked →',
        series: [prange, stern],
        hlines: [{ y: floor, cls: 'poly-floor' }],
        markers,
        vline: s.hints,
      }),
      chartCap,
      chartDesc,
    );
    const cur = points[s.hints];
    chartDesc.textContent =
      `At ${s.hints} of ${MAIN.w} hints, modelled total work is ${fmtBits(cur.prangeBits)} for Prange and ` +
      `${fmtBits(cur.sternBits)} for Stern — Stern is ${fmtBits(cur.prangeBits - cur.sternBits)} cheaper. ` +
      (cur.polynomial ? 'The search has collapsed to polynomial time for both.' : 'Selected algorithm: ' + ALGO_LABEL[s.algo] + '.');
  }
  subscribe(update);

  return el('section', { class: 'card', 'aria-labelledby': 'curve-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['3']), 'Watch it collapse']),
    el('h2', { id: 'curve-h' }, ['Two axes at once: the algorithm and the hints']),
    el('p', { class: 'lede' }, [
      'This is the whole result in one picture, and it separates two things. The ',
      el('strong', {}, ['vertical gap']),
      ' between the two lines is the ',
      el('strong', {}, ['algorithm axis']),
      ' — Stern’s birthday search is genuinely cheaper than Prange on the same instance. Sliding right is the ',
      el('strong', {}, ['hint axis']),
      ' — leakage helps ',
      el('em', {}, ['both']),
      ' algorithms, and the gap narrows as the problem gets easy. The dots are the ',
      el('strong', {}, ['measured']),
      ' averages of the real runs you launch above; run each algorithm at a few hint counts to plot them.',
    ]),
    duplicateSlider(),
    chartHost,
    el('div', { class: 'legend', 'aria-hidden': 'true' }, [
      el('span', {}, [el('span', { class: 'swatch curve-prange' }), 'Prange (model)']),
      el('span', {}, [el('span', { class: 'swatch curve-stern' }), 'Stern (model)']),
      el('span', {}, [el('span', { class: 'swatch dot-prange' }), 'Prange measured']),
      el('span', {}, [el('span', { class: 'swatch dot-stern' }), 'Stern measured']),
      el('span', {}, [el('span', { class: 'swatch floor' }), 'polynomial floor']),
    ]),
  ]);
}

/** A second copy of the hint slider so the chart is drivable from its own card. */
function duplicateSlider(): HTMLElement {
  const slider = el('input', {
    type: 'range',
    id: 'hint-slider-2',
    min: '0',
    max: String(MAIN.w),
    step: '1',
    value: String(state.hints),
    'aria-label': 'Perfect hints leaked (mirrors the slider above)',
  }) as HTMLInputElement;
  slider.addEventListener('input', () => setHints(Number(slider.value)));
  subscribe((s) => (slider.value = String(s.hints)));
  return el('div', { class: 'control' }, [
    el('label', { for: 'hint-slider-2' }, ['Perfect hints leaked']),
    slider,
  ]);
}

function sectionApprox(): HTMLElement {
  // Approximate (noisy-weight) hints — a MODELLED soft-decision extension.
  const blockSize = 6;
  let noiseBits = 1;
  const out = el('p', { class: 'readout-line', role: 'status', 'aria-live': 'polite' });
  const noise = el('input', {
    type: 'range',
    id: 'noise-slider',
    min: '0',
    max: String(Math.floor(Math.log2(blockSize + 1) * 10)),
    step: '1',
    value: '10',
    'aria-describedby': 'noise-out',
  }) as HTMLInputElement;

  function refresh() {
    noiseBits = Number(noise.value) / 10;
    const gain = approxGainBits(blockSize, noiseBits);
    clear(out);
    out.append(
      document.createTextNode(`A noisy weight meter over a ${blockSize}-coordinate block carries at most `),
      el('span', { class: 'mono' }, [fmtBits(Math.log2(blockSize + 1))]),
      document.createTextNode(`. With ${noiseBits.toFixed(1)} bits of noise it still shaves `),
      el('strong', {}, [fmtBits(gain)]),
      document.createTextNode(' off the search exponent — a softer discount than a perfect fault, applied per hint.'),
    );
  }
  noise.addEventListener('input', refresh);
  refresh();

  return el('section', { class: 'card', 'aria-labelledby': 'approx-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'tag tag-model' }, ['Model']), 'The other kind of hint']),
    el('h2', { id: 'approx-h' }, ['Approximate hints: soft, noisy side-channel leakage']),
    el('p', { class: 'lede' }, [
      'The second lineage (ISD-with-Hints, ePrint 2021/279) does not leak an exact bit — it leaks a ',
      el('strong', {}, ['noisy Hamming weight']),
      ' over a block of coordinates, the kind of thing a power trace gives you. Hint-ISD recasts this as ',
      el('strong', {}, ['soft-decision decoding']),
      ': instead of a yes/no, each coordinate gets a probability, and the attacker guesses the likely-zero positions first.',
    ]),
    el('div', { class: 'control' }, [
      el('label', { for: 'noise-slider' }, ['Measurement noise (bits of uncertainty left by the meter)']),
      noise,
      el('p', { id: 'noise-out' }, [out]),
    ]),
    el('p', { class: 'footnote' }, [
      'Unlike the perfect-hint panel above — which ',
      el('em', {}, ['runs']),
      ' the real decoder — this discount is ',
      el('strong', {}, ['modelled']),
      ', not executed: the exact information a meter yields depends on the acquisition hardware. The formula is ',
      el('code', {}, ['log2(blockSize+1) − noiseBits']),
      ', in ',
      el('code', {}, ['src/sdp/workfactor.ts']),
      '.',
    ]),
  ]);
}

function sectionCompare(): HTMLElement {
  const grid = el('div', { class: 'compare-grid' });
  const contrast = schemeContrast();

  for (const scheme of SCHEMES) {
    const c = contrast.find((x) => x.id === scheme.id)!;
    const toy = makeInstance(scheme.toy);
    const runOut = el('p', { class: 'readout-line', role: 'status', 'aria-live': 'polite' });

    const runBtn = el('button', { type: 'button', class: 'btn' }, [`Run ISD on the ${scheme.name} toy`]);
    runBtn.addEventListener('click', () => {
      const noHints = runAttack(toy, [], { seed: 7 });
      const support: number[] = Array.from(toy.e).flatMap((b, i) => (b ? [i] : []));
      const allHints: PerfectHint[] = support.map((index) => ({ kind: 'perfect', index, value: 1 as const }));
      const withHints = runAttack(toy, allHints, { seed: 7 });
      clear(runOut);
      runOut.append(
        el('span', { class: 'cmp-pass' }, ['✓']),
        document.createTextNode(
          ` no hints: ${noHints.iterations.toLocaleString()} iterations. With all ${c.hintsToPoly} support hints: ${withHints.iterations} iterations (polynomial).`,
        ),
      );
    });

    grid.append(
      el('div', { class: 'scheme-card' }, [
        el('h3', {}, [
          scheme.name,
          document.createTextNode(' '),
          el('span', { class: `pill pill-${scheme.posture}` }, [
            scheme.posture === 'fragile' ? '⚠️ fragile' : '🛡️ resistant',
          ]),
        ]),
        el('p', { class: 'scheme-stat' }, [`real: ${scheme.realParams}`]),
        el('p', { class: 'scheme-stat' }, [`n = `, el('b', {}, [scheme.realN.toLocaleString()]), `, error weight t = `, el('b', {}, [String(scheme.realT)])]),
        el('p', { class: 'prose small' }, [scheme.blurb]),
        el('p', { class: 'scheme-stat' }, [
          `toy instance: n=${scheme.toy.n}, w=${scheme.toy.w} → hints to polynomial = `,
          el('b', {}, [String(c.hintsToPoly)]),
        ]),
        el('div', { class: 'btn-row' }, [runBtn]),
        runOut,
      ]),
    );
  }

  return el('section', { class: 'card', 'aria-labelledby': 'compare-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['4']), 'Why weight decides fragility']),
    el('h2', { id: 'compare-h' }, ['Classic McEliece vs HQC — the error-weight finding']),
    el('p', { class: 'lede' }, [
      'Both schemes rest on syndrome decoding, but they live at opposite ends of the ',
      el('strong', {}, ['error-weight']),
      ' axis. McEliece decodes a high-weight error, so its support is a big set and each leaked coordinate barely dents the search. HQC decodes a low-weight error, so a handful of leaked coordinates is a large share of the whole secret. Fewer hints push the low-weight scheme to polynomial time — that is the paper’s finding, and you can run both toys to see it.',
    ]),
    grid,
    el('p', { class: 'footnote' }, [
      'The large ',
      el('code', {}, ['n']),
      ' and ',
      el('code', {}, ['t']),
      ' are the real Level-1 parameters, quoted as facts; only the small ',
      el('strong', {}, ['toy']),
      ' instances actually run in your browser. They share each scheme’s high-vs-low-weight shape, so the contrast is honest even though the magnitudes are not the real ones.',
    ]),
  ]);
}

function sectionReference(): HTMLElement {
  const noHintExp = searchExponentBits({ n: MAIN.n, r: MAIN.r, w: MAIN.w });
  return el('section', { class: 'card', 'aria-labelledby': 'ref-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'tag' }, ['Reference']), 'Verify it yourself']),
    el('h2', { id: 'ref-h' }, ['Parameters, formula & sources']),
    el(
      'details',
      { open: true },
      [
        el('summary', {}, ['The math behind the curve']),
        el('div', { class: 'prose' }, [
          el('p', {}, [
            'For a Prange-style ISD, the expected number of random column guesses to confine a weight-',
            el('code', {}, ['w']),
            ' error to the ',
            el('code', {}, ['r']),
            ' chosen columns is ',
            el('code', {}, ['C(n,w) / C(r,w)']),
            ', so the guessing work in bits is:',
          ]),
          el('pre', { class: 'formula' }, [el('code', {}, ['search_bits(n, r, w) = log2 C(n,w) − log2 C(r,w)'])]),
          el('p', {}, [
            `For this demo's instance (n=${MAIN.n}, r=${MAIN.r}, w=${MAIN.w}) that is `,
            el('code', {}, [fmtBits(noHintExp)]),
            ' with no hints. Each perfect support hint drops both ',
            el('code', {}, ['n']),
            ' and ',
            el('code', {}, ['w']),
            ` by one, and at w=0 the exponent is zero — polynomial time. The explicit bound is ${hintsToPolynomial(MAIN.w)} hints (= w).`,
          ]),
          el('p', {}, [
            'Total work multiplies that by a per-permutation Gaussian-elimination cost (≈ r² row-combines, the ',
            el('code', {}, [fmtBits(polyFloorBits(MAIN.r))]),
            ' polynomial floor). Prange pays it once per single-candidate test; ',
            el('strong', {}, ['Stern']),
            ' amortises it over a birthday/collision search of the information set:',
          ]),
          el('pre', { class: 'formula' }, [
            el('code', {}, ['stern_iters = C(n,w) / [ C(k/2,p)·C(k/2,p)·C(r−ℓ, w−2p) ]']),
          ]),
          (() => {
            const sp = bestSternParams({ n: MAIN.n, r: MAIN.r, w: MAIN.w });
            return el('p', {}, [
              `For this instance the solver picks p=${sp.p}, ℓ=${sp.l}, so total work is `,
              el('code', {}, [bitsToWork(prangeWorkBits({ n: MAIN.n, r: MAIN.r, w: MAIN.w }))]),
              ' for Prange versus ',
              el('code', {}, [bitsToWork(sternWorkBits({ n: MAIN.n, r: MAIN.r, w: MAIN.w }))]),
              ' for Stern — the gap you see on the chart. Both are counted in the same GF(2) row-combine unit, and the real solvers count the same operations, so the measured dots land near the modelled curves. ',
              el('span', { class: 'muted' }, ['(MMT and BJMM would lower the Stern line further; they are named, not implemented.)']),
            ]);
          })(),
        ]),
      ],
    ),
    el('details', {}, [
      el('summary', {}, ['Sources']),
      el('div', { class: 'prose' }, [
        el('ul', {}, [
          el('li', {}, [
            'D’Achille, Esser, Kraus, ',
            el('em', {}, ['Syndrome Decoding with Hints']),
            ', IACR ePrint ',
            el('a', { href: 'https://eprint.iacr.org/2026/341', target: '_blank', rel: 'noopener noreferrer' }, ['2026/341']),
            ' — the Hint-ISD framing this demo visualises.',
          ]),
          el('li', {}, ['Cayrel et al., Eurocrypt ’21 — perfect hints via fault injection.']),
          el('li', {}, [
            'ISD-with-Hints, IACR ePrint ',
            el('a', { href: 'https://eprint.iacr.org/2021/279', target: '_blank', rel: 'noopener noreferrer' }, ['2021/279']),
            ' — Hamming-weight (approximate) hints.',
          ]),
          el('li', {}, ['Stern, ', el('em', {}, ['A method for finding codewords of small weight']), ' (1989); Bernstein–Lange–Peters, ', el('em', {}, ['Attacking and defending the McEliece cryptosystem']), ' (PQCrypto 2008) — the implemented Stern variant and its cost model.']),
          el('li', {}, ['All arithmetic is in ', el('code', {}, ['src/sdp/']), ' (Prange in ', el('code', {}, ['isd.ts']), ', Stern in ', el('code', {}, ['stern.ts']), '); the tests (incl. Hamming [7,4] KATs for both) are the colocated ', el('code', {}, ['*.test.ts']), ' files.']),
        ]),
      ]),
    ]),
  ]);
}

function sectionFaq(): HTMLElement {
  const qa: [string, (Node | string)[]][] = [
    [
      'Does this break Classic McEliece or HQC?',
      ['No. With no hints the search is fully exponential — the schemes are sound. This shows what happens ', el('em', {}, ['when a fault or side channel leaks part of the secret']), '; the fix is to prevent the leakage, not to change the math.'],
    ],
    [
      'Is the attack real or a simulation?',
      ['The perfect-hint path is real for both algorithms: ', el('code', {}, ['src/sdp/isd.ts']), ' (Prange) and ', el('code', {}, ['src/sdp/stern.ts']), ' (Stern) actually decode the F₂ instance and every result is verified against H·e = s. The approximate-hint discount is a labelled model. The large per-scheme numbers are quoted facts on real parameters; only the toy instances run in-browser.'],
    ],
    [
      'Is Stern really different from Prange, or a relabelled loop?',
      ['Genuinely different. Stern brings H to systematic form, splits the information set in half, and runs a birthday/collision search for an error with p ones in each half and none in an ℓ-row window — meeting in the middle so one expensive elimination is reused across many candidates. That is why its work factor is visibly lower. MMT and BJMM refine the middle step further and are ', el('strong', {}, ['named, not implemented']), '.'],
    ],
    [
      'Why does low weight make HQC more fragile?',
      ['A weight-t error hidden in n positions has a support that is a fraction t/n of the code. When t/n is small (HQC), each leaked coordinate is a big share of the whole secret, so few hints suffice. When t is large (McEliece), the same leak removes only a sliver.'],
    ],
    [
      'Does recovering e mean I can forge a ciphertext?',
      ['No — and the demo says so throughout. Solving the syndrome instance recovers the ', el('strong', {}, ['error vector e']), '. Turning that into a full key or decryption forgery is a separate step this demo does not perform.'],
    ],
    [
      'Why is the measured dot not exactly on the curve?',
      ['The curve is the ', el('em', {}, ['expected']), ' work; a single ISD run is a random draw around it. The red dot averages several real runs, so it sits close — the scatter is the honest reality of a randomized search.'],
    ],
  ];
  return el('section', { class: 'card', 'aria-labelledby': 'faq-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'tag' }, ['Good to know']), 'Common misreadings']),
    el('h2', { id: 'faq-h' }, ['Frequently asked questions']),
    el(
      'dl',
      {},
      qa.flatMap(([q, a]) => [
        el('div', { class: 'faq-item' }, [el('dt', { class: 'faq-q' }, [q]), el('dd', { class: 'faq-a' }, a)]),
      ]),
    ),
  ]);
}

function sectionGaps(): HTMLElement {
  return el('section', { class: 'card', 'aria-labelledby': 'gaps-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'tag' }, ['Caveats']), 'Honest scope']),
    el('h2', { id: 'gaps-h' }, ['What is real, what is modelled, what this does NOT prove']),
    el('ul', { class: 'prose' }, [
      el('li', {}, ['Not production crypto — a teaching demo. It runs no real McEliece/HQC key recovery (browser-infeasible); it attacks small but genuine F₂ instances.']),
      el('li', {}, [el('span', { class: 'tag tag-real' }, ['Real']), ' The instances, the syndromes, and both perfect-hint ISD attacks — Prange and Stern — are executed and verified (H·e = s). Only these two algorithms are implemented.']),
      el('li', {}, [el('span', { class: 'tag tag-model' }, ['Model']), ' The work-factor curves (Prange and Stern expectations) and the approximate-hint discount: transparent formulas, labelled where shown. MMT and BJMM are named as further refinements but are NOT implemented.']),
      el('li', {}, ['The slider leaks the informative (support) coordinates; general faults help less, so treat the “≈ w hints” bound as the best case.']),
      el('li', {}, ['Both algorithms recover the error vector e. Neither produces a decryption forgery or a full key recovery, and the demo does not model the physical acquisition that produces hints.']),
    ]),
  ]);
}

// ===========================================================================
// Mount
// ===========================================================================
function main() {
  const host = $('#content');
  host.append(
    sectionIntro(),
    sectionPrimer(),
    sectionAttack(),
    sectionCurve(),
    sectionApprox(),
    sectionCompare(),
    sectionReference(),
    sectionFaq(),
    sectionGaps(),
  );
  setHints(0);
}

main();

// Render the parity-check matrix as a compact table (inside a scroll region).
function renderMatrix(inst: Instance): HTMLElement {
  const table = el('table', { class: 'matrix' });
  const cap = el('caption', { class: 'visually-hidden' }, [
    `Parity-check matrix H with ${inst.r} rows and ${inst.n} columns over F2. A 1 means that column feeds that parity check.`,
  ]);
  table.append(cap);
  const head = el('tr', {}, [el('td', { class: 'collabel' }, [''])]);
  for (let j = 0; j < inst.n; j++) head.append(el('td', { class: 'collabel' }, [String(j)]));
  table.append(head);
  for (let r = 0; r < inst.r; r++) {
    const tr = el('tr', {}, [el('td', { class: 'rowlabel' }, [`r${r}`])]);
    for (let j = 0; j < inst.n; j++) {
      const one = inst.H[r][j] === 1;
      tr.append(el('td', { class: one ? 'one' : '' }, [one ? '1' : '·']));
    }
    table.append(tr);
  }
  return table;
}
