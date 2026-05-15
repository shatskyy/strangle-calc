#!/usr/bin/env node
// Test runner for strangle-calc-core.js.
// Run with: node tests/run.js
// Exits non-zero if any test fails.

const path = require('path');
const core = require(path.join(__dirname, '..', 'strangle-calc-core.js'));

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  ok  ${name}\n`);
    passed++;
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n`);
    process.stdout.write(`       ${err.message}\n`);
    if (err.stack) {
      const lines = err.stack.split('\n').slice(1, 3).map(l => '       ' + l.trim()).join('\n');
      process.stdout.write(lines + '\n');
    }
    failed++;
    failures.push({ name, err });
  }
}

function group(name, fn) {
  process.stdout.write(`\n${name}\n`);
  fn();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'expected ===' } : actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}
function assertClose(actual, expected, msg, eps = 1e-9) {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > eps) {
    throw new Error(`${msg || 'expected ~=' } : actual=${actual} expected=${expected}`);
  }
}
function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'expected deep equal'} : actual=${a} expected=${b}`);
}
function assertMatch(actual, regex, msg) {
  if (typeof actual !== 'string' || !regex.test(actual)) {
    throw new Error(`${msg || 'expected match'} : actual=${JSON.stringify(actual)} regex=${regex}`);
  }
}

// ── Strict numeric validation ──────────────────────────────────────────────
group('strict numeric validation', () => {
  test('accepts plain integer', () => {
    assertEqual(core.isStrictNumber('5'), true);
    assertEqual(core.strictNumber('5'), 5);
  });
  test('accepts decimal', () => {
    assertEqual(core.isStrictNumber('6.5'), true);
    assertEqual(core.strictNumber('6.5'), 6.5);
  });
  test('accepts leading-dot decimal', () => {
    assertEqual(core.isStrictNumber('.5'), true);
    assertClose(core.strictNumber('.5'), 0.5);
  });
  test('accepts trailing-dot decimal', () => {
    assertEqual(core.isStrictNumber('5.'), true);
    assertClose(core.strictNumber('5.'), 5);
  });
  test('accepts negative number', () => {
    assertEqual(core.isStrictNumber('-0.25'), true);
    assertClose(core.strictNumber('-0.25'), -0.25);
  });
  test('rejects "6.5abc" (no parseFloat-style partial)', () => {
    assertEqual(core.isStrictNumber('6.5abc'), false);
    assertEqual(core.strictNumber('6.5abc'), null);
  });
  test('rejects "abc"', () => {
    assertEqual(core.isStrictNumber('abc'), false);
    assertEqual(core.strictNumber('abc'), null);
  });
  test('rejects lone dot', () => {
    assertEqual(core.isStrictNumber('.'), false);
  });
  test('rejects scientific notation', () => {
    assertEqual(core.isStrictNumber('5e3'), false);
  });
  test('empty string is null (allowed)', () => {
    assertEqual(core.strictNumber(''), null);
    assertEqual(core.strictNumber('   '), null);
    assertEqual(core.cellState(''), 'empty');
    assertEqual(core.cellState('   '), 'empty');
  });
  test('cellState distinguishes empty vs invalid vs ok', () => {
    assertEqual(core.cellState('6.5'), 'ok');
    assertEqual(core.cellState('6.5abc'), 'invalid');
    assertEqual(core.cellState(''), 'empty');
  });
});

// ── Solve modes ────────────────────────────────────────────────────────────
group('solve modes', () => {
  const atmBid = 6.025, atmOffer = 6.6;
  const flyBid = 0.475, flyOffer = 0.725;
  const strBid = 6.5,   strOffer = 7.325;

  test('ATM + Fly -> Strangle', () => {
    const out = core.solve('STR', { atmBid, atmOffer, flyBid, flyOffer });
    assertClose(out.strBid,   strBid);
    assertClose(out.strOffer, strOffer);
    assertClose(out.atmBid,   atmBid);   // source preserved
    assertClose(out.flyBid,   flyBid);
  });

  test('ATM + Strangle -> Fly', () => {
    const out = core.solve('FLY', { atmBid, atmOffer, strBid, strOffer });
    assertClose(out.flyBid,   flyBid);
    assertClose(out.flyOffer, flyOffer);
  });

  test('Fly + Strangle -> ATM', () => {
    const out = core.solve('ATM', { flyBid, flyOffer, strBid, strOffer });
    assertClose(out.atmBid,   atmBid);
    assertClose(out.atmOffer, atmOffer);
  });

  test('missing source produces null derived value', () => {
    const out = core.solve('STR', { atmBid: 6.025, atmOffer: 6.6, flyBid: null, flyOffer: 0.725 });
    assertEqual(out.strBid, null);     // atm fine but fly bid null
    assertClose(out.strOffer, 7.325);
  });

  test('unknown mode throws', () => {
    let threw = false;
    try { core.solve('BOGUS', {}); } catch (_) { threw = true; }
    assertEqual(threw, true);
  });
});

// ── Parser: happy path ─────────────────────────────────────────────────────
group('parser: happy path', () => {
  const atmText = [
    'USD/CHF NYK ATM',
    '1W 5.275/6.925',
    '1M 6.025/6.6',
    '3M 6.5/7.025',
  ].join('\n');

  test('parses ATM header', () => {
    const r = core.parseRun(atmText);
    assert(r.ok, 'expected ok');
    assertEqual(r.run.ccy, 'USD/CHF');
    assertEqual(r.run.cut, 'NYK');
    assertEqual(r.run.type, 'ATM');
    assertEqual(r.run.delta, null);
  });

  test('parses tenors with original strings preserved', () => {
    const r = core.parseRun(atmText);
    assertClose(r.run.tenors['1M'].bid,   6.025);
    assertClose(r.run.tenors['1M'].offer, 6.6);
    assertEqual(r.run.tenors['1M'].bidStr,   '6.025');
    assertEqual(r.run.tenors['1M'].offerStr, '6.6');
  });

  test('parses FLY header with delta', () => {
    const r = core.parseRun('USD/CHF NYK 10D FLY\n1M 0.475/0.725');
    assert(r.ok);
    assertEqual(r.run.type, 'FLY');
    assertEqual(r.run.delta, '10D');
  });

  test('parses lowercase delta', () => {
    const r = core.parseRun('USD/CHF NYK 25d fly\n1M 0.5/0.7');
    assert(r.ok);
    assertEqual(r.run.delta, '25D');
  });

  test('parses missing cut', () => {
    const r = core.parseRun('USD/CHF ATM\n1M 6.0/6.5');
    assert(r.ok);
    assertEqual(r.run.cut, '');
  });
});

// ── Parser: errors ─────────────────────────────────────────────────────────
group('parser: errors', () => {
  test('malformed tenor line: reports line number and original text', () => {
    const text = [
      'USD/CHF NYK ATM',
      '1M 6.025/6.6',
      'nonsense gibberish',
      '3M 6.5/7.0',
    ].join('\n');
    const r = core.parseRun(text);
    assertEqual(r.ok, false);
    const msg = r.errors.join('\n');
    assertMatch(msg, /Line 3:/, 'should report line 3');
    assertMatch(msg, /malformed tenor line/i);
    assertMatch(msg, /nonsense gibberish/);
  });

  test('"6.5abc" in a tenor line is malformed, not silently truncated', () => {
    const r = core.parseRun('USD/CHF NYK ATM\n1M 6.5abc/6.6');
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /Line 2:.*malformed/i);
  });

  test('duplicate tenor in a run: reports line number', () => {
    const text = [
      'USD/CHF NYK ATM',
      '1M 6.025/6.6',
      '2M 6.35/6.875',
      '1M 6.0/6.5',
    ].join('\n');
    const r = core.parseRun(text);
    assertEqual(r.ok, false);
    const msg = r.errors.join('\n');
    assertMatch(msg, /Line 4:/);
    assertMatch(msg, /duplicate tenor/i);
    assertMatch(msg, /1M/);
  });

  test('header without currency pair', () => {
    const r = core.parseRun('JUNK NYK ATM\n1M 6.0/6.5');
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /no currency pair/i);
  });

  test('header without ATM or FLY', () => {
    const r = core.parseRun('USD/CHF NYK\n1M 6.0/6.5');
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /unrecognised structure/i);
  });

  test('empty text returns null', () => {
    assertEqual(core.parseRun(''), null);
    assertEqual(core.parseRun('   \n\n  '), null);
  });
});

// ── parseFlyBlock ─────────────────────────────────────────────────────────
group('parseFlyBlock', () => {
  test('parses multiple deltas separated by blank line', () => {
    const text = [
      'USD/CHF NYK 10D FLY',
      '1M 0.475/0.725',
      '',
      'USD/CHF NYK 25D FLY',
      '1M 0.85/1.1',
    ].join('\n');
    const r = core.parseFlyBlock(text);
    assertEqual(r.ok, true);
    assertEqual(r.runs.length, 2);
    assertEqual(r.runs[0].delta, '10D');
    assertEqual(r.runs[1].delta, '25D');
  });

  test('duplicate delta is rejected with line numbers', () => {
    const text = [
      'USD/CHF NYK 10D FLY',
      '1M 0.475/0.725',
      '',
      'USD/CHF NYK 10D FLY',
      '1M 0.5/0.8',
    ].join('\n');
    const r = core.parseFlyBlock(text);
    assertEqual(r.ok, false);
    const msg = r.errors.join('\n');
    assertMatch(msg, /duplicate fly delta/i);
    assertMatch(msg, /10D/);
    assertMatch(msg, /Line 4:/);
    assertMatch(msg, /first seen on line 1/i);
  });

  test('line numbers within a later block reference original text', () => {
    const text = [
      'USD/CHF NYK 10D FLY',  // line 1
      '1M 0.475/0.725',       // line 2
      '',                     // line 3
      'USD/CHF NYK 25D FLY',  // line 4
      'bad line here',        // line 5 — malformed
    ].join('\n');
    const r = core.parseFlyBlock(text);
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /Line 5:.*malformed/i);
  });

  test('first run reported as non-FLY when ATM is pasted in fly area', () => {
    const r = core.parseFlyBlock('USD/CHF NYK ATM\n1M 6.0/6.5');
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /expected a FLY run/i);
  });
});

// ── parseATM ───────────────────────────────────────────────────────────────
group('parseATM', () => {
  test('rejects multi-block ATM input', () => {
    const text = [
      'USD/CHF NYK ATM',
      '1M 6.0/6.5',
      '',
      'USD/CHF NYK ATM',
      '2M 6.2/6.7',
    ].join('\n');
    const r = core.parseATM(text);
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /only one run/i);
  });

  test('rejects FLY pasted in ATM area', () => {
    const r = core.parseATM('USD/CHF NYK 10D FLY\n1M 0.475/0.725');
    assertEqual(r.ok, false);
    assertMatch(r.errors.join('\n'), /expected an ATM run/i);
  });
});

// ── Compatibility check ────────────────────────────────────────────────────
group('compatibility check', () => {
  const baseAtm = { ccy: 'USD/CHF', cut: 'NYK' };

  test('currency mismatch is rejected', () => {
    const errs = core.validateCompatibility(baseAtm, { ccy: 'EUR/USD', cut: 'NYK', delta: '10D' });
    assert(errs.length >= 1);
    assertMatch(errs.join('\n'), /currency mismatch/i);
  });

  test('cut mismatch is rejected', () => {
    const errs = core.validateCompatibility(baseAtm, { ccy: 'USD/CHF', cut: 'LDN', delta: '10D' });
    assert(errs.length >= 1);
    assertMatch(errs.join('\n'), /cut mismatch/i);
  });

  test('compatible run yields no errors', () => {
    const errs = core.validateCompatibility(baseAtm, { ccy: 'USD/CHF', cut: 'NYK', delta: '10D' });
    assertEqual(errs.length, 0);
  });

  test('missing cut on both sides is treated as match', () => {
    const errs = core.validateCompatibility(
      { ccy: 'USD/CHF', cut: '' },
      { ccy: 'USD/CHF', cut: '', delta: '10D' }
    );
    assertEqual(errs.length, 0);
  });
});

// ── Row flags (crossed / negative) ─────────────────────────────────────────
group('row flags', () => {
  test('crossed ATM detected when bid >= offer', () => {
    const f = core.rowFlags({ atmBid: 6.7, atmOffer: 6.6, flyBid: 0.4, flyOffer: 0.7 });
    assertEqual(f.crossedATM, true);
  });

  test('crossed strangle detected', () => {
    const f = core.rowFlags({ strBid: 7.5, strOffer: 7.0 });
    assertEqual(f.crossedStr, true);
  });

  test('crossed fly detected', () => {
    const f = core.rowFlags({ flyBid: 0.9, flyOffer: 0.5 });
    assertEqual(f.crossedFly, true);
  });

  test('non-crossed market has no flags', () => {
    const f = core.rowFlags({ atmBid: 6.0, atmOffer: 6.5, flyBid: 0.4, flyOffer: 0.7 });
    assertEqual(f.crossedATM, false);
    assertEqual(f.crossedFly, false);
  });

  test('negative ATM bid detected', () => {
    const f = core.rowFlags({ atmBid: -0.1, atmOffer: 6.5 });
    assertEqual(f.negAtmBid, true);
    assertEqual(f.negAtmOffer, false);
  });

  test('negative strangle offer detected', () => {
    const f = core.rowFlags({ strBid: -1.0, strOffer: -0.5 });
    assertEqual(f.negStrBid, true);
    assertEqual(f.negStrOffer, true);
  });

  test('negative fly is flagged (warning, separate field)', () => {
    const f = core.rowFlags({ flyBid: -0.1, flyOffer: 0.7 });
    assertEqual(f.negFlyBid, true);
    assertEqual(f.negFlyOffer, false);
  });
});

// ── Output formatter ──────────────────────────────────────────────────────
group('output formatter', () => {
  test('formats header and tenor lines, skips rows with missing strangle', () => {
    const out = core.formatStrangleOutput('USD/CHF', 'NYK', '10D', [
      { tenor: '1M', strBid: 6.5, strOffer: 7.325 },
      { tenor: '2M', strBid: null, strOffer: null },       // blank → skipped
      { tenor: '3M', strBid: 7.15, strOffer: 7.9 },
    ]);
    assertEqual(out, [
      'USD/CHF NYK 10D STRANGLE',
      '1M   6.500/7.325',
      '3M   7.150/7.900',
    ].join('\n'));
  });
});

// ── Integration: full paste → output ──────────────────────────────────────
group('integration: parse + solve + format', () => {
  test('USD/CHF 1M produces 1M 6.500/7.325', () => {
    const atmText = 'USD/CHF NYK ATM\n1M 6.025/6.6';
    const flyText = 'USD/CHF NYK 10D FLY\n1M 0.475/0.725';
    const atm = core.parseATM(atmText);
    const fly = core.parseFlyBlock(flyText);
    assert(atm.ok); assert(fly.ok);
    const a = atm.run.tenors['1M'], f = fly.runs[0].tenors['1M'];
    const s = core.solve('STR', { atmBid: a.bid, atmOffer: a.offer, flyBid: f.bid, flyOffer: f.offer });
    assertClose(s.strBid,   6.500);
    assertClose(s.strOffer, 7.325);
    const out = core.formatStrangleOutput(atm.run.ccy, atm.run.cut, fly.runs[0].delta,
      [{ tenor: '1M', strBid: s.strBid, strOffer: s.strOffer }]);
    assertMatch(out, /USD\/CHF NYK 10D STRANGLE/);
    assertMatch(out, /1M\s+6\.500\/7\.325/);
  });

  test('missing tenor in one run produces blank output for that tenor', () => {
    // 2M present in ATM, absent in FLY
    const atm = { tenors: { '1M': { bid: 6.025, offer: 6.6 }, '2M': { bid: 6.35, offer: 6.875 } } };
    const fly = { tenors: { '1M': { bid: 0.475, offer: 0.725 } } };

    const allTenors = ['1M', '2M'];
    const rows = allTenors.map(t => {
      const a = atm.tenors[t], f = fly.tenors[t];
      const s = core.solve('STR', {
        atmBid:   a ? a.bid   : null, atmOffer: a ? a.offer : null,
        flyBid:   f ? f.bid   : null, flyOffer: f ? f.offer : null,
      });
      return { tenor: t, strBid: s.strBid, strOffer: s.strOffer };
    });
    const out = core.formatStrangleOutput('USD/CHF', 'NYK', '10D', rows);
    // Only the 1M line should appear; 2M is skipped because fly is missing.
    assertMatch(out, /1M\s+6\.500\/7\.325/);
    assert(!/2M/.test(out), 'expected 2M to be omitted from output');
  });

  test('USD/CHF ATM + EUR/USD fly is rejected (currency mismatch)', () => {
    const atm = core.parseATM('USD/CHF NYK ATM\n1M 6.0/6.5');
    const fly = core.parseFlyBlock('EUR/USD NYK 10D FLY\n1M 0.4/0.7');
    assert(atm.ok); assert(fly.ok);
    const errs = core.validateCompatibility(atm.run, fly.runs[0]);
    assert(errs.length >= 1);
    assertMatch(errs.join('\n'), /currency mismatch/i);
  });

  test('USD/CHF NYK ATM + USD/CHF LDN fly is rejected (cut mismatch)', () => {
    const atm = core.parseATM('USD/CHF NYK ATM\n1M 6.0/6.5');
    const fly = core.parseFlyBlock('USD/CHF LDN 10D FLY\n1M 0.4/0.7');
    assert(atm.ok); assert(fly.ok);
    const errs = core.validateCompatibility(atm.run, fly.runs[0]);
    assert(errs.length >= 1);
    assertMatch(errs.join('\n'), /cut mismatch/i);
  });
});

// ── Summary ────────────────────────────────────────────────────────────────
process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
