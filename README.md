# Strangle Calculator

Standalone FX volatility desk tool. Paste ATM and butterfly vol runs, get implied strangle runs. All cells are editable for reverse-solving. No backend, no dependencies, no build step.

---

## Usage

1. Open `strangle-calc.html` directly in Chrome or Edge.
2. Paste an ATM vol run into the left textarea.
3. Paste one or more fly runs into the right textarea (separate multiple deltas with a blank line).
4. The table populates automatically on paste. Hit **Calculate** if needed.
5. Review the interactive table. Edit any cell to trigger reverse-solving.
6. Copy the formatted output block for each delta using the **Copy** button.

---

## Input Format

**ATM run**
```
USD/CHF NYK ATM
1W 5.275/6.925
2W 5.5/6.6
1M 6.025/6.600
3M 6.5/7.025
1Y 7.175/7.675
```

**Fly run(s)**
```
USD/CHF NYK 10D FLY
1M 0.475/0.725
3M 0.65/0.875
1Y 1.025/1.25

USD/CHF NYK 25D FLY
1M 0.30/0.55
3M 0.45/0.70
```

- Header: `CCY/CCY CUT ATM` or `CCY/CCY CUT {N}D FLY`
- Tenor line format: `<tenor> <bid>/<offer>` — e.g. `1M 6.025/6.600`
- Multiple fly runs at different deltas in one paste, separated by blank lines
- Tenors are joined on exact match; no interpolation for missing tenors

---

## Core Formulas

**ATM + Fly → Strangle** (primary, on paste)
```
strangle_bid   = atm_bid   + fly_bid
strangle_offer = atm_offer + fly_offer
```

**ATM + Strangle → Fly** (when a strangle cell is edited)
```
fly_bid   = strangle_bid   - atm_bid
fly_offer = strangle_offer - atm_offer
```

**Fly + Strangle → ATM** (when an ATM cell is edited after strangle is set)
```
atm_bid   = strangle_bid   - fly_bid
atm_offer = strangle_offer - fly_offer
```

Each row independently tracks which two of the three structures are source. Computed values are colored cyan/green to distinguish them from typed input.

---

## Validation

| Rule | Behaviour |
|---|---|
| Currency pair mismatch (ATM vs fly) | Section rejected, error shown |
| Cut mismatch (e.g. NYK vs LDN) | Section rejected, error shown |
| Duplicate tenor within a run | Rejected, line number reported |
| Duplicate fly delta | Rejected, both header line numbers reported |
| Malformed tenor line | Error with line number; line is not silently skipped |
| Non-numeric cell input | Cell highlighted red; excluded from calculation |
| Crossed market (bid ≥ offer) | Row highlighted red |
| Negative ATM or strangle vol | Highlighted as error |
| Negative fly vol | Highlighted as warning (amber); not blocked |

Errors appear in the message area above the results table. Valid sections still render when one section has an error.

---

## Assumptions and Limitations

- **No interpolation.** Tenors present in one run but absent in the other are left blank.
- **No pricing model.** This is arithmetic only — no Black-Scholes, no smile construction.
- **No vol surface construction.** Deltas are taken as-is from the headers; no consistency check across deltas.
- **No saved history.** Stateless — refreshing the page clears everything.
- **No backend.** Pure client-side HTML/JS. Nothing is transmitted anywhere.
- **Not connected to Bloomberg, DMS, SDR, or any live data source.**
- **Verify market convention before use.** Different desks may define fly differently (e.g. broker butterfly vs. risk reversal conventions). Confirm the formula applies to your workflow before using output in a real trading context.

---

## File Layout

```
strangle-calc.html      — UI shell (open this in the browser)
strangle-calc-core.js   — pure logic: parser, validator, solver, formatter
tests/run.js            — Node test runner (no npm install needed)
```

---

## Running Tests

```
node tests/run.js
```

Requires Node.js (no `npm install`). Prints one line per test (`ok` / `FAIL`), grouped by area, with a final pass/fail count. Exits non-zero on any failure.

Tests cover: strict numeric validation, all three solve modes, parser happy paths, every documented error (malformed line, duplicate tenor, duplicate delta, ccy/cut mismatch), crossed-market detection, and negative-vol detection.

---

## Branch Notes

`main` is the stable branch.

Branches prefixed `claude/` are experimental working branches used during development. They are preserved for reference but are not guaranteed to be stable or complete. Do not rely on them for desk use.
