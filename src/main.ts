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
  elimOps,
  prangeWorkBits,
  sternWorkBits,
  bestSternParams,
  approxGainBits,
  hintsToPolynomial,
} from './sdp/workfactor';
import { SCHEMES, schemeContrast } from './sdp/schemes';

// ---------------------------------------------------------------------------
// The single interactive SDP instance the main panels attack. Sized at the
// Gilbert–Varshamov bound (n=64, k=24, w=11): the planted weight-11 error is
// essentially the UNIQUE low-weight solution, so the unique-solution work model
// is honest and the measured medians land within ~1 bit of it. Prange visibly
// struggles (~2^8 information sets) where Stern's birthday search does not.
// A genuine H·e = s instance over F_2, decoded live by both real solvers.
// ---------------------------------------------------------------------------
const MAIN: Instance = makeInstance({ n: 64, k: 24, w: 11, seed: 0xa11 });
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

/** The perfect hints for the first `count` support coordinates (informative leaks). */
function hintsForCount(count: number): PerfectHint[] {
  return SUPPORT.slice(0, count).map((index) => ({ kind: 'perfect', index, value: 1 }));
}

/** Run the selected real solver once against the real instance at `count` hints. */
function runSolver(algo: Algo, count: number, seed: number): AttackResult {
  const hints = hintsForCount(count);
  return algo === 'stern' ? runStern(MAIN, hints, { seed }) : runAttack(MAIN, hints, { seed });
}

const TRIALS = 15; // enough distinct seeds to report a stable median + interval

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

interface RunRecord {
  id: number;
  algo: Algo;
  hints: number;
  residualN: number;
  residualW: number;
  trials: number;
  medianBits: number;
  p10Bits: number;
  p90Bits: number;
  medianIters: number;
  verified: boolean;
  /** One genuine recovered error vector (verified) to display. */
  sample: AttackResult;
}

const runLog: RunRecord[] = [];
let runCounter = 0;

/**
 * Run `TRIALS` genuine, distinctly-seeded attacks and summarise them with a
 * median and a p10–p90 interval — honest about the geometric spread of a
 * randomized search instead of hiding it behind a single mean. Records the run
 * and (unless the hints alone already solve it) plots the median on the chart.
 */
function runExperiment(algo: Algo, count: number): RunRecord {
  const works: number[] = [];
  const iters: number[] = [];
  let verified = true;
  let sample = runSolver(algo, count, 1);
  for (let seed = 1; seed <= TRIALS; seed++) {
    const r = runSolver(algo, count, seed);
    if (seed === 1) sample = r;
    works.push(r.work);
    iters.push(r.iterations);
    verified = verified && r.solved && r.verified;
  }
  works.sort((a, b) => a - b);
  iters.sort((a, b) => a - b);
  const toBits = (v: number) => Math.log2(Math.max(1, v));
  const rec: RunRecord = {
    id: ++runCounter,
    algo,
    hints: count,
    residualN: sample.reduced.n,
    residualW: sample.reduced.w,
    trials: TRIALS,
    medianBits: toBits(quantile(works, 0.5)),
    p10Bits: toBits(quantile(works, 0.1)),
    p90Bits: toBits(quantile(works, 0.9)),
    medianIters: quantile(iters, 0.5),
    verified,
    sample,
  };
  runLog.unshift(rec); // newest first
  if (MAIN.w - count > 0) measured[algo].set(count, rec.medianBits);
  return rec;
}

function resetRuns() {
  runLog.length = 0;
  measured.prange.clear();
  measured.stern.clear();
  notify();
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

  // role="group": a plain div is role=generic, where `aria-label` is prohibited
  // and silently discarded. These 48 toggles are one meaningful grouping, which
  // is what `group` describes; the sibling row at the top of sectionAttack()
  // already carries the same role for the same reason.
  const bitRow = el('div', {
    class: 'bit-row',
    role: 'group',
    'aria-label': 'Candidate error vector — click a bit to flip it',
  });
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
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['3']), 'Inspect the instance']),
    el('h2', { id: 'primer-h' }, ['The syndrome-decoding instance, for real']),
    el('p', { class: 'lede' }, [
      'This is the very instance the attack above ran on — a genuine one over F₂: a public parity-check matrix ',
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
    el('details', { class: 'hand-decode' }, [
      el('summary', {}, ['Try to decode it by hand (48 toggles)']),
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
    ]),
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
  let revealTruth = false; // default: show only what the ATTACKER knows

  const slider = el('input', {
    type: 'range',
    id: 'hint-slider',
    min: '0',
    max: String(MAIN.w),
    step: '1',
    value: '0',
    'aria-describedby': 'hint-readout',
  }) as HTMLInputElement;
  const sliderOut = el('output', { class: 'slider-out', for: 'hint-slider' }, ['0']);

  const readout = el('p', { class: 'readout-line', id: 'hint-readout', role: 'status', 'aria-live': 'polite' });
  const errorRow = el('div', {
    class: 'bit-row',
    role: 'group',
    'aria-label': 'The error vector from the attacker’s view; ? means unknown, 🔓 means leaked',
  });
  const revealBtn = el('button', { type: 'button', class: 'preset' }, ['Show planted truth']);
  revealBtn.addEventListener('click', () => {
    revealTruth = !revealTruth;
    revealBtn.textContent = revealTruth ? 'Hide planted truth' : 'Show planted truth';
    revealBtn.setAttribute('aria-pressed', String(revealTruth));
    notify();
  });
  const meter = el('div', { class: 'meter', role: 'status', 'aria-live': 'polite' });
  const result = el('div', { class: 'result-region', role: 'status', 'aria-live': 'polite' });

  // Comparative run log — runs accumulate instead of replacing each other.
  const runTableBody = el('tbody', { id: 'run-body' });
  const runTable = el('table', { class: 'readout run-table' }, [
    el('caption', { class: 'visually-hidden' }, [
      'Every attack you run, newest first: algorithm, hints, residual instance, median work over ' +
        TRIALS +
        ' seeds with a p10–p90 spread, median permutations, and whether the recovered error verified.',
    ]),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['#']),
        el('th', { scope: 'col' }, ['Algorithm']),
        el('th', { scope: 'col' }, ['Hints']),
        el('th', { scope: 'col' }, ['Residual (n, w)']),
        el('th', { scope: 'col' }, ['Median work']),
        el('th', { scope: 'col' }, ['p10–p90']),
        el('th', { scope: 'col' }, ['Median perms']),
        el('th', { scope: 'col' }, ['Verified']),
      ]),
    ]),
    runTableBody,
  ]);

  function renderTable() {
    clear(runTableBody);
    if (runLog.length === 0) {
      runTableBody.append(
        el('tr', {}, [el('td', { colspan: '8', class: 'muted' }, ['No runs yet — press Run or Run both.'])]),
      );
      return;
    }
    for (const r of runLog) {
      runTableBody.append(
        el('tr', {}, [
          el('td', {}, [String(r.id)]),
          el('td', {}, [ALGO_LABEL[r.algo]]),
          el('td', { class: 'mono' }, [String(r.hints)]),
          el('td', { class: 'mono' }, [`(${r.residualN}, ${r.residualW})`]),
          el('td', { class: 'mono' }, [fmtBits(r.medianBits)]),
          el('td', { class: 'mono' }, [`${r.p10Bits.toFixed(1)}–${r.p90Bits.toFixed(1)}`]),
          el('td', { class: 'mono' }, [r.medianIters.toLocaleString()]),
          el('td', {}, [
            r.verified
              ? el('span', { class: 'cmp-pass' }, ['✓ H·e=s'])
              : el('span', { class: 'cmp-fail' }, ['✗']),
          ]),
        ]),
      );
    }
  }

  slider.addEventListener('input', () => setHints(Number(slider.value)));

  const runBtn = el('button', { type: 'button', class: 'btn btn-accent' }, ['Run the real ISD attack']);
  runBtn.addEventListener('click', () => runOne(state.algo));
  const runBothBtn = el('button', { type: 'button', class: 'btn' }, ['Run both algorithms']);
  runBothBtn.addEventListener('click', () => runBoth());
  const resetBtn = el('button', { type: 'button', class: 'preset' }, ['Reset runs']);
  resetBtn.addEventListener('click', () => {
    resetRuns();
    renderTable();
    clear(result);
  });

  function runOne(algo: Algo) {
    const rec = runExperiment(algo, state.hints);
    renderResult([rec]);
    renderTable();
    notify();
  }
  function runBoth() {
    const pr = runExperiment('prange', state.hints);
    const st = runExperiment('stern', state.hints);
    renderResult([pr, st]);
    renderTable();
    notify();
  }

  function renderResult(recs: RunRecord[]) {
    clear(result);
    // Show one genuine recovered, verified error vector (the "break it" moment).
    const withE = recs.find((r) => r.sample.recovered) ?? recs[0];
    const sample = withE.sample;
    const solved = sample.solved && sample.recovered;

    result.append(
      el('div', { class: 'meter' }, [
        el('span', { class: `meter-badge ${solved ? 'state-broken' : 'state-hard'}` }, [
          solved ? '💥' : '🛡️',
          solved ? 'error recovered' : 'no solution within the cap',
        ]),
        el('p', { class: 'meter-text' }, [
          ...recs.map((r) =>
            el('span', { class: 'run-line' }, [
              el('strong', {}, [ALGO_LABEL[r.algo]]),
              document.createTextNode(
                `: median ${fmtBits(r.medianBits)} (p10–p90 ${r.p10Bits.toFixed(1)}–${r.p90Bits.toFixed(1)}), ` +
                  `${r.medianIters.toLocaleString()} median permutations over ${r.trials} seeds. `,
              ),
              r.verified ? el('span', { class: 'cmp-pass' }, ['✓ verified']) : el('span', { class: 'cmp-fail' }, ['✗']),
            ]),
          ),
        ]),
      ]),
    );
    if (solved && sample.recovered) {
      const sternParams = 'params' in withE.sample ? (withE.sample as { params: { p: number; l: number } }).params : null;
      result.append(
        el('p', { class: 'readout-line mono' }, [`recovered e = ${bitstring(sample.recovered)}`]),
        el('p', { class: 'footnote' }, [
          `Residual instance the ${state.hints} hint${state.hints === 1 ? '' : 's'} left: length n=${sample.reduced.n}, weight w=${sample.reduced.w}.` +
            (sternParams && sternParams.p > 0 ? ` Stern used p=${sternParams.p}, ℓ=${sternParams.l}.` : ''),
          ' This recovers the error vector e — not a decryption forgery.',
        ]),
      );
    } else {
      result.append(
        el('p', { class: 'footnote' }, ['Leak more hints and try again — the residual search is still beyond the cap.']),
      );
    }
  }

  function update(s: State) {
    slider.value = String(s.hints);
    sliderOut.textContent = String(s.hints);
    const cur = workCurves()[s.hints];

    clear(readout);
    readout.append(
      el('strong', {}, [`${s.hints} of ${MAIN.w} perfect hints`]),
      document.createTextNode(
        ` — residual weight ${cur.w}. Modelled total work: Prange ${bitsToWork(cur.prangeBits)}, Stern ${bitsToWork(cur.sternBits)} elementary ops.`,
      ),
    );

    // Error vector from the ATTACKER's view: unknown coords are "?", leaked ones
    // show their value with a lock. "Show planted truth" reveals the real vector.
    clear(errorRow);
    for (let i = 0; i < MAIN.n; i++) {
      const isSupport = MAIN.e[i] === 1;
      const known = isSupport && SUPPORT.indexOf(i) < s.hints;
      let glyph: string, cls: string, aria: string;
      if (known) {
        glyph = '🔓';
        cls = 'bit set support hint-known';
        aria = `Position ${i}: leaked, error bit 1`;
      } else if (revealTruth) {
        glyph = isSupport ? '1' : '0';
        cls = `bit${isSupport ? ' set support' : ''}`;
        aria = `Position ${i}: ${isSupport ? 'error bit 1' : 'zero'} (planted truth)`;
      } else {
        glyph = '?';
        cls = 'bit unknown';
        aria = `Position ${i}: unknown to the attacker`;
      }
      // role="img", not a bare span. `aria-label` is PROHIBITED on the generic
      // role a <span> maps to: the browser discards it and axe files it under
      // aria-prohibited-attr in `incomplete`, never as a violation — so all 48
      // of these labels reached nobody, and the cell read as a bare index plus
      // a "?" or an unlocked-padlock emoji. Each cell genuinely IS a glyph
      // standing for a state, which is what role="img" describes, and the name
      // then replaces the index + glyph rather than competing with it.
      errorRow.append(
        el('span', { class: cls, role: 'img', 'aria-label': aria }, [
          el('span', { class: 'idx' }, [String(i)]),
          glyph,
        ]),
      );
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
  renderTable();

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
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['1']), 'Break it yourself']),
    el('h2', { id: 'attack-h' }, ['Pick an algorithm, feed it hints, run it for real']),
    el('p', { class: 'lede' }, [
      'A ',
      el('strong', {}, ['perfect hint']),
      ' here leaks one exact coordinate of the secret error — the ',
      el('strong', {}, ['known error locations']),
      ' hint of ISD-with-Hints (ePrint 2021/279), the kind of leak a template or power-analysis attack on a decoder yields. ',
      el('span', { class: 'tag tag-model' }, ['Adapted']),
      ' The slider leaks the informative (support) coordinates, so the “≈ w hints” bound below is this leakage model’s best case. A separate channel — the Cayrel et al. (Eurocrypt ’21) fault attack, which leaks syndrome entries over the integers — is cited here, not simulated. Choose which real solver to run — ',
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
      el('div', { class: 'slider-row' }, [
        el('span', { class: 'slider-end' }, ['0']),
        slider,
        el('span', { class: 'slider-end' }, [String(MAIN.w)]),
        sliderOut,
      ]),
      readout,
    ]),
    el('div', { class: 'error-head' }, [
      el('h3', {}, ['The error vector — attacker’s view']),
      revealBtn,
    ]),
    errorRow,
    el('p', { class: 'footnote' }, [
      '“?” is a coordinate the attacker has not learned; ',
      el('strong', {}, ['🔓']),
      ' is one a hint leaked. Use ',
      el('em', {}, ['Show planted truth']),
      ' to peek at the real error (teaching only — the attacker never sees this).',
    ]),
    meter,
    el('div', { class: 'btn-row' }, [runBtn, runBothBtn, resetBtn]),
    result,
    el('h3', {}, ['Your runs (newest first)']),
    // tabindex + role: .table-scroll is `overflow: auto` and a table holds
    // nothing focusable, so at phone width this eight-column run log scrolled
    // with no keyboard route at all (WCAG 2.1.1). role="region" is what makes
    // the tab stop announce itself rather than arriving unnamed.
    el(
      'div',
      { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Attack run log' },
      [runTable],
    ),
    el('p', { class: 'footnote' }, [
      'Each run is ',
      String(TRIALS),
      ' genuine attacks on distinct seeds; the table reports the ',
      el('strong', {}, ['median']),
      ' work with a p10–p90 spread, because a single randomized search has a wide geometric spread. The slider leaks the ',
      el('em', {}, ['informative']),
      ` case — coordinates actually in the support. Revealing the whole weight-${MAIN.w} support (${MAIN.w} hints) leaves nothing to search, the crisp `,
      el('strong', {}, ['hint-count-to-polynomial bound of this support-leakage model: ≈ w hints']),
      '. This is this demo’s bound, not a verbatim restatement of the paper’s general result.',
    ]),
  ]);
}

function sectionCurve(): HTMLElement {
  const chartHost = el('figure', { class: 'chart-wrap', role: 'group', 'aria-label': 'Work-factor curves' });
  const chartCap = el('figcaption', { class: 'chart-cap', id: 'work-chart-cap' }, [
    'Total attack work (log₂ of the elementary-operation ledger) versus perfect hints leaked, for both real algorithms. The upper line is Prange, the lower line is Stern — the vertical gap between them is the algorithm advantage, and both fall toward the polynomial floor (dashed) as hints add up. Dots are the median of the real runs you launched; the vertical line marks the current hint count. The same numbers are in the data table below.',
  ]);
  const chartDesc = el('p', { class: 'visually-hidden', id: 'work-chart-desc', role: 'status', 'aria-live': 'polite' });
  const dataBody = el('tbody');

  function renderDataTable(points: WorkPoint[]) {
    clear(dataBody);
    for (const p of points) {
      const mp = measured.prange.get(p.hints);
      const ms = measured.stern.get(p.hints);
      dataBody.append(
        el('tr', {}, [
          el('td', { class: 'mono' }, [String(p.hints)]),
          el('td', { class: 'mono' }, [`${p.n}, ${p.w}`]),
          el('td', { class: 'mono' }, [p.prangeBits.toFixed(1)]),
          el('td', { class: 'mono' }, [p.sternBits.toFixed(1)]),
          el('td', { class: 'mono' }, [mp == null ? '—' : mp.toFixed(1)]),
          el('td', { class: 'mono' }, [ms == null ? '—' : ms.toFixed(1)]),
        ]),
      );
    }
  }

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
    renderDataTable(points);
    const cur = points[s.hints];
    chartDesc.textContent =
      `At ${s.hints} of ${MAIN.w} hints, modelled total work is ${fmtBits(cur.prangeBits)} for Prange and ` +
      `${fmtBits(cur.sternBits)} for Stern — Stern is ${fmtBits(cur.prangeBits - cur.sternBits)} cheaper. ` +
      (cur.polynomial ? 'The search has collapsed to polynomial time for both.' : 'Selected algorithm: ' + ALGO_LABEL[s.algo] + '.');
  }
  subscribe(update);

  const dataTable = el('details', { class: 'chart-data' }, [
    el('summary', {}, ['Chart data (model bits per hint, plus your measured medians)']),
    el(
      'div',
      { class: 'table-scroll', tabindex: '0', role: 'region', 'aria-label': 'Chart data table' },
      [
      el('table', { class: 'readout' }, [
        el('caption', { class: 'visually-hidden' }, [
          'Modelled total work in bits for Prange and Stern at each hint count, and the median measured work from any runs you launched.',
        ]),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { scope: 'col' }, ['Hints']),
            el('th', { scope: 'col' }, ['Residual n, w']),
            el('th', { scope: 'col' }, ['Prange model']),
            el('th', { scope: 'col' }, ['Stern model']),
            el('th', { scope: 'col' }, ['Prange measured']),
            el('th', { scope: 'col' }, ['Stern measured']),
          ]),
        ]),
        dataBody,
      ]),
      ],
    ),
  ]);

  return el('section', { class: 'card', 'aria-labelledby': 'curve-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['2']), 'Watch it collapse']),
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
      el('strong', {}, ['measured medians']),
      ' of the real runs you launch above; run each algorithm at a few hint counts to plot them.',
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
    dataTable,
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
      document.createTextNode(' off the search exponent — a softer discount than an exact location leak, applied per hint.'),
    );
  }
  noise.addEventListener('input', refresh);
  refresh();

  return el('section', { class: 'card', 'aria-labelledby': 'approx-h' }, [
    el('p', { class: 'eyebrow' }, [el('span', { class: 'tag tag-model' }, ['Model']), 'The other kind of hint']),
    el('h2', { id: 'approx-h' }, ['Approximate hints: soft, noisy side-channel leakage']),
    el('p', { class: 'lede' }, [
      'The other hint in ISD-with-Hints (ePrint 2021/279) does not leak an exact bit — it leaks a ',
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
            scheme.posture === 'fragile' ? '↓ fewer hints (toy)' : '↑ more hints (toy)',
          ]),
        ]),
        el('p', { class: 'scheme-stat' }, [
          'real: ',
          el('a', { href: scheme.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, [scheme.realParams]),
        ]),
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
    el('p', { class: 'eyebrow' }, [el('span', { class: 'step-num' }, ['4']), 'How error weight drives hint-fragility']),
    el('h2', { id: 'compare-h' }, ['The error-weight mechanism, on two toys']),
    el('p', { class: 'lede' }, [
      'The mechanism, stated exactly as the model implements it: ',
      el('strong', {}, ['a lower-weight error reaches polynomial time after fewer support hints']),
      ' — and the code length ',
      el('em', {}, ['does not enter the bound at all']),
      '. These two toys are set at different weights (w = 6 vs w = 3) to show that — run both and compare their hints-to-polynomial counts. They illustrate the mechanism; they are ',
      el('strong', {}, ['not scaled models']),
      ' of the real schemes.',
    ]),
    grid,
    el('p', { class: 'footnote' }, [
      el('span', { class: 'tag tag-model' }, ['Adapted']),
      ' The real ',
      el('code', {}, ['n']),
      ' and ',
      el('code', {}, ['t']),
      ' are quoted Level-1 facts; the toy weights are not scaled from them. Read literally at the real numbers, this demo’s bound gives 64 hints for McEliece and 66 for HQC — the two schemes have nearly the same ',
      el('em', {}, ['absolute']),
      ' error weight, so the bound does not separate them, and the toys exaggerate the gap on purpose so the mechanism stays visible. They differ instead in relative weight (t/n ≈ 1.8% vs 0.37%) and structure, which set the starting height of the curve rather than its hint budget. Which scheme Hint-ISD judges more hint-sensitive follows from its full analysis, which this browser demo does not reproduce.',
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
          // Same WCAG 2.1.1 reason as the tables: .formula scrolls sideways
          // at 380px and holds nothing focusable.
          el(
            'pre',
            { class: 'formula', tabindex: '0', role: 'region', 'aria-label': 'Search-bits formula' },
            [el('code', {}, ['search_bits(n, r, w) = log2 C(n,w) − log2 C(r,w)'])],
          ),
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
            el('code', {}, [fmtBits(Math.log2(elimOps(MAIN.r)))]),
            ' polynomial floor). Prange pays it once per single-candidate test; ',
            el('strong', {}, ['Stern']),
            ' amortises it over a birthday/collision search of the information set:',
          ]),
          el(
            'pre',
            { class: 'formula', tabindex: '0', role: 'region', 'aria-label': 'Stern iterations formula' },
            [el('code', {}, ['stern_iters = C(n,w) / [ C(k/2,p)·C(k/2,p)·C(r−ℓ, w−2p) ]'])],
          ),
          (() => {
            const sp = bestSternParams({ n: MAIN.n, r: MAIN.r, w: MAIN.w });
            return el('p', {}, [
              `For this instance the solver picks p=${sp.p}, ℓ=${sp.l}, so total work is `,
              el('code', {}, [bitsToWork(prangeWorkBits({ n: MAIN.n, r: MAIN.r, w: MAIN.w }))]),
              ' for Prange versus ',
              el('code', {}, [bitsToWork(sternWorkBits({ n: MAIN.n, r: MAIN.r, w: MAIN.w }))]),
              ' for Stern — the gap you see on the chart. Both curves and the real solvers count the same elementary-operation ledger (row-combines, candidate tests, and Stern list entries), so the measured dots land near — not exactly on — the modelled curves. ',
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
            ' — the Hint-ISD framing this demo visualises: hints recast the SDP as soft-decision decoding, and adapted ISD interpolates from exponential toward polynomial time.',
          ]),
          el('li', {}, [
            'Cayrel et al., Eurocrypt ’21 — the fault attack behind Hint-ISD’s “perfect hints”: it suppresses the modular reduction so the attacker reads ',
            el('strong', {}, ['syndrome entries over the integers']),
            '. That is a different channel from the error-location leak implemented here — cited as related work, not simulated.',
          ]),
          el('li', {}, [
            'Horlemann, Puchinger, Renner, Schamberger, Wachter-Zeh, ',
            el('em', {}, ['Information-Set Decoding with Hints']),
            ', IACR ePrint ',
            el('a', { href: 'https://eprint.iacr.org/2021/279', target: '_blank', rel: 'noopener noreferrer' }, ['2021/279']),
            ' — the source of both hints this demo implements: ',
            el('strong', {}, ['known error locations']),
            ' (the perfect-hint slider) and known subblock Hamming weights (the approximate-hint model).',
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
      'Is HQC more hint-fragile than Classic McEliece?',
      [
        'Not by this demo’s model, at the Level-1 parameters quoted here. The bound implemented is ',
        el('strong', {}, ['hints to polynomial = w']),
        ', and the code length never enters it — so mceliece348864 (t = 64) and hqc-128 (t = 66) come out within 3% of each other, and if anything the model asks for two ',
        el('em', {}, ['more']),
        ' hints against HQC. Absolute error weight is the whole fragility axis: a lighter error does collapse sooner, which is exactly what the two toys (w = 6 vs w = 3) demonstrate. What t/n changes (1.8% vs 0.37%) is how much security the instance starts with, not how many hints end it. Hint-ISD’s full analysis does conclude that higher-weight schemes such as McEliece resist hint exposure better than smaller-weight ones such as HQC — but that follows from its complete estimator, which this browser demo does not reproduce.',
      ],
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
      el('li', {}, [el('span', { class: 'tag tag-model' }, ['Adapted']), ' A perfect hint here is a direct error-coordinate reveal — the “known error locations” hint of ISD-with-Hints (ePrint 2021/279). It is NOT the Cayrel et al. fault channel, which leaks syndrome entries over the integers; that one is cited, not implemented. The slider leaks the informative (support) coordinates, so the “≈ w hints to polynomial” bound is this leakage model’s best case, not a verbatim restatement of Hint-ISD’s general result.']),
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
    sectionAttack(),
    sectionCurve(),
    sectionPrimer(),
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
