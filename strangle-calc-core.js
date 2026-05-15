// Pure logic for the FX Strangle Calculator: parser, validator, solver, formatter.
// Loaded in the browser by strangle-calc.html (exposes window.StrangleCore) and
// imported by the Node test runner under tests/.
//
// No DOM access here. No build step. No dependencies.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StrangleCore = factory();
  }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {

  // ── Tenor order ─────────────────────────────────────────────────────────
  const TENOR_ORDER = ['1W','2W','3W','1M','2M','3M','4M','5M','6M','9M','1Y','18M','2Y','3Y','5Y'];
  const TENOR_RANK  = Object.fromEntries(TENOR_ORDER.map((t, i) => [t, i]));

  function tenorRank(t) {
    const r = TENOR_RANK[String(t).toUpperCase()];
    return r !== undefined ? r : 999;
  }

  // ── Strict numeric validation ───────────────────────────────────────────
  // Accept optional sign, then either "digits[.digits?]" or ".digits".
  // Reject "6.5abc", "abc", ".", "5e3", "1,5", whitespace-only.
  const NUM_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function isStrictNumber(s) {
    if (typeof s !== 'string') return false;
    const t = s.trim();
    return t.length > 0 && NUM_RE.test(t);
  }

  // Return parsed number for a strictly-valid string. null for empty OR invalid.
  function strictNumber(s) {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (t === '' || !NUM_RE.test(t)) return null;
    return parseFloat(t);
  }

  // Distinguish empty vs invalid for UI purposes.
  // Returns 'empty' | 'invalid' | 'ok'.
  function cellState(s) {
    if (typeof s !== 'string') return 'empty';
    const t = s.trim();
    if (t === '') return 'empty';
    if (!NUM_RE.test(t)) return 'invalid';
    return 'ok';
  }

  function fmt(v) { return v.toFixed(3); }

  // ── Tenor-line regex ────────────────────────────────────────────────────
  // Anchored — partial matches like "1M 6.5abc/6.6" are rejected.
  const TENOR_LINE_RE =
    /^([0-9]+[DWMY])\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/i;

  // ── Parser ──────────────────────────────────────────────────────────────
  //
  // parseRun(text, lineOffset)
  //   Parses ONE run (header + tenor lines). Empty lines inside are skipped.
  //   lineOffset is 0-based; used to report line numbers relative to the
  //   original textarea when called via parseFlyBlock.
  //
  // Returns:
  //   null                      — text is empty after trimming
  //   { ok: false, errors: [] } — one or more errors (each tagged with 1-based line number)
  //   { ok: true,  run: { ccy, cut, type, delta, tenors, tenorOrder } }
  function parseRun(text, lineOffset) {
    if (lineOffset == null) lineOffset = 0;
    const rawLines = String(text).split('\n');
    const nonEmpty = [];
    for (let i = 0; i < rawLines.length; i++) {
      const trimmed = rawLines[i].trim();
      if (trimmed) nonEmpty.push({ lineNo: lineOffset + i + 1, trimmed });
    }
    if (!nonEmpty.length) return null;

    const header = nonEmpty[0];

    const ccyM = header.trimmed.match(/([A-Z]{3}\/[A-Z]{3})/i);
    if (!ccyM) {
      return { ok: false, errors: [
        `Line ${header.lineNo}: no currency pair found in header "${header.trimmed}"`
      ]};
    }
    const ccy = ccyM[1].toUpperCase();
    const [base, quote] = ccy.split('/');

    // Cut = first 3-letter token that isn't base/quote/FLY/ATM.
    const cutM = (header.trimmed.match(/\b([A-Z]{3})\b/gi) || [])
      .map(s => s.toUpperCase())
      .find(s => s !== base && s !== quote && s !== 'FLY' && s !== 'ATM');
    const cut = cutM || '';

    const flyM = header.trimmed.match(/\b(\d+D)\s+FLY\b/i);
    const atmM = header.trimmed.match(/\bATM\b/i);
    let type, delta;
    if (atmM)      { type = 'ATM'; delta = null; }
    else if (flyM) { type = 'FLY'; delta = flyM[1].toUpperCase(); }
    else return { ok: false, errors: [
      `Line ${header.lineNo}: unrecognised structure in header "${header.trimmed}"`
    ]};

    const tenors = {};
    const tenorOrder = [];
    const errors = [];

    for (let i = 1; i < nonEmpty.length; i++) {
      const line = nonEmpty[i];
      const m = line.trimmed.match(TENOR_LINE_RE);
      if (!m) {
        errors.push(`Line ${line.lineNo}: malformed tenor line "${line.trimmed}"`);
        continue;
      }
      const tenor = m[1].toUpperCase();
      if (tenors[tenor] !== undefined) {
        errors.push(
          `Line ${line.lineNo}: duplicate tenor "${tenor}" in ` +
          `${type}${delta ? ' ' + delta : ''} run`
        );
        continue;
      }
      tenors[tenor] = {
        bid: +m[2], offer: +m[3],
        bidStr: m[2], offerStr: m[3],
      };
      tenorOrder.push(tenor);
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, run: { ccy, cut, type, delta, tenors, tenorOrder } };
  }

  // Split text into contiguous non-blank line blocks. Returns the lines and
  // the [start,end) index of each block. Blank lines separate blocks.
  function splitBlocks(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let curStart = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '') {
        if (curStart !== -1) { blocks.push([curStart, i]); curStart = -1; }
      } else if (curStart === -1) {
        curStart = i;
      }
    }
    if (curStart !== -1) blocks.push([curStart, lines.length]);
    return { lines, blocks };
  }

  // parseFlyBlock(text)
  //   Parses zero or more FLY runs separated by blank lines.
  //   Detects duplicate deltas across the block.
  // Returns: { ok, errors, runs }
  function parseFlyBlock(text) {
    const { lines, blocks } = splitBlocks(text);
    const errors = [];
    const runs = [];
    const seenDeltas = new Map(); // delta -> first header line number

    for (const [start, end] of blocks) {
      const subText = lines.slice(start, end).join('\n');
      const result = parseRun(subText, start);
      if (!result) continue;
      if (!result.ok) { errors.push(...result.errors); continue; }
      const run = result.run;
      if (run.type !== 'FLY') {
        errors.push(
          `Line ${start + 1}: expected a FLY run in the fly textarea, got ${run.type} ` +
          `in "${lines[start].trim()}"`
        );
        continue;
      }
      if (seenDeltas.has(run.delta)) {
        errors.push(
          `Line ${start + 1}: duplicate fly delta "${run.delta}" ` +
          `(first seen on line ${seenDeltas.get(run.delta)})`
        );
        continue;
      }
      seenDeltas.set(run.delta, start + 1);
      runs.push(run);
    }
    return { ok: errors.length === 0, errors, runs };
  }

  // parseATM(text)
  //   Parses a single ATM run. Multiple blocks are not supported here.
  function parseATM(text) {
    const { lines, blocks } = splitBlocks(text);
    if (!blocks.length) return null;
    if (blocks.length > 1) {
      return { ok: false, errors: [
        `Line ${blocks[1][0] + 1}: ATM textarea should contain only one run`
      ]};
    }
    const [start, end] = blocks[0];
    const subText = lines.slice(start, end).join('\n');
    const result = parseRun(subText, start);
    if (!result) return null;
    if (!result.ok) return result;
    if (result.run.type !== 'ATM') {
      return { ok: false, errors: [
        `Line ${start + 1}: expected an ATM run in the ATM textarea, got ${result.run.type}`
      ]};
    }
    return result;
  }

  // ── Compatibility check ─────────────────────────────────────────────────
  function validateCompatibility(atm, fly) {
    const errors = [];
    if (atm.ccy !== fly.ccy) {
      errors.push(
        `Currency mismatch for ${fly.delta} fly: ATM is ${atm.ccy}, FLY is ${fly.ccy}`
      );
    }
    if (atm.cut !== fly.cut) {
      errors.push(
        `Cut mismatch for ${fly.delta} fly: ATM is ${atm.cut || '(none)'}, ` +
        `FLY is ${fly.cut || '(none)'}`
      );
    }
    return errors;
  }

  // ── Solve engine ────────────────────────────────────────────────────────
  // SOURCE_FIELDS[mode] is the set of fields treated as input. The other two
  // are derived. Arrays here so consumers can build Sets if they want.
  const SOURCE_FIELDS = {
    STR: ['atmBid','atmOffer','flyBid','flyOffer'],  // derive strBid, strOffer
    FLY: ['atmBid','atmOffer','strBid','strOffer'],  // derive flyBid, flyOffer
    ATM: ['flyBid','flyOffer','strBid','strOffer'],  // derive atmBid, atmOffer
  };

  // Pure solver. Takes a vals object with all six fields (any may be null)
  // and a mode; returns a new vals object with the derived fields filled in.
  function solve(mode, vals) {
    const v = {
      atmBid:   vals.atmBid   ?? null,
      atmOffer: vals.atmOffer ?? null,
      flyBid:   vals.flyBid   ?? null,
      flyOffer: vals.flyOffer ?? null,
      strBid:   vals.strBid   ?? null,
      strOffer: vals.strOffer ?? null,
    };
    if (mode === 'STR') {
      v.strBid   = (v.atmBid   !== null && v.flyBid   !== null) ? v.atmBid   + v.flyBid   : null;
      v.strOffer = (v.atmOffer !== null && v.flyOffer !== null) ? v.atmOffer + v.flyOffer : null;
    } else if (mode === 'FLY') {
      v.flyBid   = (v.strBid   !== null && v.atmBid   !== null) ? v.strBid   - v.atmBid   : null;
      v.flyOffer = (v.strOffer !== null && v.atmOffer !== null) ? v.strOffer - v.atmOffer : null;
    } else if (mode === 'ATM') {
      v.atmBid   = (v.strBid   !== null && v.flyBid   !== null) ? v.strBid   - v.flyBid   : null;
      v.atmOffer = (v.strOffer !== null && v.flyOffer !== null) ? v.strOffer - v.flyOffer : null;
    } else {
      throw new Error(`Unknown solve mode: ${mode}`);
    }
    return v;
  }

  // Helpers for highlighting. Pure: no DOM.
  function rowFlags(vals) {
    const has = v => v !== null && v !== undefined && !Number.isNaN(v);
    return {
      crossedATM: has(vals.atmBid) && has(vals.atmOffer) && vals.atmBid >= vals.atmOffer,
      crossedFly: has(vals.flyBid) && has(vals.flyOffer) && vals.flyBid >= vals.flyOffer,
      crossedStr: has(vals.strBid) && has(vals.strOffer) && vals.strBid >= vals.strOffer,
      negAtmBid:   has(vals.atmBid)   && vals.atmBid   < 0,
      negAtmOffer: has(vals.atmOffer) && vals.atmOffer < 0,
      negFlyBid:   has(vals.flyBid)   && vals.flyBid   < 0,
      negFlyOffer: has(vals.flyOffer) && vals.flyOffer < 0,
      negStrBid:   has(vals.strBid)   && vals.strBid   < 0,
      negStrOffer: has(vals.strOffer) && vals.strOffer < 0,
    };
  }

  // ── Output formatter ────────────────────────────────────────────────────
  // rows: array of { tenor, strBid, strOffer }. Rows whose strangle is
  // missing (null/undefined) are skipped — that produces blank output for
  // tenors that exist on one run but not the other.
  function formatStrangleOutput(ccy, cut, delta, rows) {
    const header = `${ccy} ${cut} ${delta} STRANGLE`;
    const lines = [];
    for (const r of rows) {
      const sb = r.strBid, so = r.strOffer;
      if (sb === null || sb === undefined || so === null || so === undefined) continue;
      lines.push(`${r.tenor.padEnd(4)} ${fmt(sb)}/${fmt(so)}`);
    }
    return [header, ...lines].join('\n');
  }

  return {
    TENOR_ORDER, tenorRank,
    isStrictNumber, strictNumber, cellState, fmt,
    parseRun, parseFlyBlock, parseATM,
    validateCompatibility,
    SOURCE_FIELDS, solve, rowFlags,
    formatStrangleOutput,
  };
}));
