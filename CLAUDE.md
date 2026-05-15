# Strangle Calculator

FX volatility desk tool. Vanilla HTML/CSS/JS. No frameworks, no dependencies, no build step. Dark theme.

## File layout

- `strangle-calc.html` — UI shell: markup, styles, DOM-bound interaction script. Open this directly in Chrome/Edge to use the app.
- `strangle-calc-core.js` — pure logic (parser, validator, solver, formatter). Loaded by the HTML via `<script src="strangle-calc-core.js">` and consumed directly by the Node test runner. No DOM.
- `tests/run.js` — Node test runner for the core module.

The two production files must sit alongside each other. There is no build step — open the HTML directly.

## What It Does

Brokers paste ATM and butterfly vol runs, get implied strangle runs. All cells are editable for bidirectional solving. Output is copy-pastable in the same format as input.

## Calculation Engine

### Core rule (must always hold)

```
strangle_bid   = atm_bid   + fly_bid
strangle_offer = atm_offer + fly_offer
```

Bid pairs with bid, offer pairs with offer. No crossing.

### ATM + Fly → Strangle (primary, from paste)

```
strangle_bid   = atm_bid   + fly_bid
strangle_offer = atm_offer + fly_offer
```

### ATM + Strangle → Fly (when broker edits a strangle cell)

```
fly_bid   = strangle_bid   − atm_bid
fly_offer = strangle_offer − atm_offer
```

### Fly + Strangle → ATM (when broker edits an ATM cell after strangle is set)

```
atm_bid   = strangle_bid   − fly_bid
atm_offer = strangle_offer − fly_offer
```

## Input Format

Pasted as plain text. Header line + tenor lines.

ATM run example:

```
USD/CHF NYK ATM
1W 5.275/6.925
2W 5.5/6.6
1M 6.025/6.6
2M 6.35/6.875
3M 6.5/7.025
6M 6.675/7.15
9M 6.925/7.4
1Y 7.175/7.675
```

Fly run example:

```
USD/CHF NYK 10D FLY
1M 0.475/0.725
2M 0.575/0.8
3M 0.65/0.875
6M 0.85/0.925
9M 0.925/1.15
1Y 1.025/1.25
```

### Parsing Rules

- Header regex: extract ccy pair (e.g. `USD/CHF`), cut (e.g. `NYK`), structure (`ATM` or `{delta} FLY` like `10D FLY`, `25D FLY`)
- Tenor line regex (anchored, fully matched): `^([0-9]+[DWMY])\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*/\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$`
- Canonical tenor sort order: 1W, 2W, 3W, 1M, 2M, 3M, 4M, 5M, 6M, 9M, 1Y, 18M, 2Y, 3Y, 5Y
- Join ATM and fly on tenor. Show blanks (empty cells) for tenors present in one run but not the other. Do NOT interpolate.

### Validation Rules

Errors are surfaced in the red message area above the results panel. Each error references the textarea (ATM/Fly) and 1-based line number from the original paste.

- **Currency mismatch**: an ATM run and a fly run must share the same currency pair. `USD/CHF` ATM with `EUR/USD` fly is rejected and that section is not rendered.
- **Cut mismatch**: ATM and each fly run must share the same cut. `USD/CHF NYK` ATM with `USD/CHF LDN` fly is rejected and that section is not rendered.
- **Malformed tenor line**: any line in a run that doesn't fully match the tenor line regex is reported by line number with the original text. It is NOT silently skipped.
- **Duplicate tenor inside a run**: rejected with the line number of the second occurrence.
- **Duplicate fly delta**: two `{N}D FLY` blocks with the same delta are rejected; both header line numbers are reported.
- **Strict numeric validation in editable cells**: empty is allowed. Otherwise only fully numeric values are accepted (`-0.25`, `5`, `5.`, `.5`, `6.025` — but NOT `6.5abc`, `abc`, `.`, `5e3`). Invalid cells are highlighted red and are excluded from calculations; they do not contribute parseFloat-style partial values.
- **Negative ATM or Strangle vol**: highlighted as an error overlay (red).
- **Negative Fly vol**: highlighted as a warning overlay (amber). Not blocked — fly can be negative under some market conventions.

The compatibility check happens per fly section. Other valid fly sections are still rendered.

## Output Format

Formatted text matching input convention, e.g.:

```
USD/CHF NYK 10D STRANGLE
1M 6.750/7.075
2M 6.925/7.475
...
```

Separate output block per delta. One-click copy button for each.

## UI Spec

### Layout (top to bottom)

1. **Input panel**: Two textareas side by side (ATM left, Fly right). Support pasting any number of fly runs at different deltas (5D, 10D, 15D, 25D, etc.), separated by blank lines. Auto-calculate on paste. “Calculate” button as fallback.
1. **Interactive table**: One section per delta. Columns: `Tenor | ATM Bid | ATM Offer | Fly Bid | Fly Offer | Strangle Bid | Strangle Offer`. All vol cells editable.
1. **Output panel**: Formatted text block per delta with copy button.

### Interactivity

- **Per-row solve-for tracking**: Each row independently tracks which two of three structures (ATM, Fly, Strangle) are “source.” On initial paste, ATM + Fly are source → Strangle is computed. If broker edits a Strangle cell, that row switches to ATM + Strangle → Fly is recomputed. Editing Fly flips back. This is per-row, not global.
- **Color coding**: Input/source values in white. Computed/derived values in cyan or light green. Makes it instantly clear what’s calculated vs. typed.
- **Validation**: Crossed market (bid ≥ offer) → highlight row in red/amber. Negative implied vol → highlight, don’t suppress.
- **Precision**: Match input precision, default 3 decimal places.

### Multi-delta

Any number of fly runs can be pasted (5D, 10D, 15D, 25D, or any `{N}D FLY` header), separated by blank lines. Each delta renders its own section with a full ATM + Fly + Strangle table and a separate copyable output block. The parser captures the delta dynamically from the header — nothing is hardcoded to specific delta values.

### Styling

- Dark background (#1a1a2e or similar dark navy/charcoal)
- Monospace font for all numbers
- Compact table rows, no wasted space
- Professional, Bloomberg-terminal-adjacent aesthetic

## Verification Data

Using the example inputs above, expected 1M strangle output:

- strangle_bid   = atm_bid   + fly_bid   = 6.025 + 0.475 = 6.500
- strangle_offer = atm_offer + fly_offer = 6.600 + 0.725 = 7.325
- Output: `1M 6.500/7.325`

Reverse check (ATM + Strangle → Fly):

- fly_bid   = strangle_bid   − atm_bid   = 6.500 − 6.025 = 0.475 ✓
- fly_offer = strangle_offer − atm_offer = 7.325 − 6.600 = 0.725 ✓

## Constraints

- No frameworks, no build step, no external CDN links, no images, no fetches.
- Two production files (`strangle-calc.html` + `strangle-calc-core.js`) — keep them colocated.
- No localStorage (not needed — this is a stateless calculator).
- Must work in Chrome and Edge (desk browsers) by opening the HTML directly.

## Testing

The core module (`strangle-calc-core.js`) is pure JavaScript with no DOM access and is exercised by a small Node-based test runner.

```
node tests/run.js
```

Prints one line per test (`ok` / `FAIL`), grouped by area, with a final pass/fail count. Exit code is non-zero if any test fails. No npm install — uses only Node's built-in `require`.

The tests cover: strict numeric validation, all three solve modes (ATM+Fly→Strangle, ATM+Strangle→Fly, Fly+Strangle→ATM), parser happy paths, every documented parser/validation error (malformed line, duplicate tenor, duplicate delta, ccy/cut mismatch, missing tenor), crossed-market detection, and negative-vol detection.

The HTML UI is not loaded by the test runner; manually exercise the app by opening `strangle-calc.html` in Chrome/Edge.
