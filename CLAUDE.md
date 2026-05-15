# Strangle Calculator

Single-file FX volatility tool (`strangle-calc.html`). No frameworks, no dependencies, no build step. Vanilla HTML/CSS/JS in one file. Dark theme.

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
- Tenor line regex: `([0-9]+[DWMY])\s+([0-9.]+)\s*/\s*([0-9.]+)`
- Canonical tenor sort order: 1W, 2W, 3W, 1M, 2M, 3M, 4M, 5M, 6M, 9M, 1Y, 18M, 2Y, 3Y, 5Y
- Join ATM and fly on tenor. Show blanks (empty cells) for tenors present in one run but not the other. Do NOT interpolate.

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

- Single file only. No external CDN links, no images, no fetches.
- No localStorage (not needed — this is a stateless calculator).
- Must work in Chrome and Edge (desk browsers).
