# Architecture — what this is, and what makes it worth money

## The thesis, stated plainly

You have built something unusual: a **repeatable, zero-credential census of a
fragmented private market**. Youth enrichment has no trade association publishing
unit economics, no public comparables outside a couple of franchisors, and no
syndicated data product. A sponsor looking at this space today buys a consultant's
phone survey of forty operators and calls it a market study.

What you have instead is 1,547 sites, 195 operators, class-level enrollment and
price, refreshable on a weekly cadence, assembled from feeds the operators publish
on purpose. That is not a better version of the phone survey. It is a different
category of asset.

But an asset is not a product. Until today the data answered *"who is where"*. The
questions that get paid for are:

- **"How much of this market is already taken, and by whom?"** — needs a denominator
- **"Where should the next twenty units go?"** — needs trade-area demand
- **"Is this market growing or shrinking?"** — needs a time series
- **"Who could I buy?"** — needs an ownership layer
- **"How confident are you?"** — needs provenance on every number

This session built the first two and the fifth. The rest is sequenced below.

---

## What changed

### Before

```
platform feeds → site rows → dashboard
```

Everything was supply-side and site-grain. `metro` was a free-text label, blank on
32% of rows, with no population attached. Every metric was a count or a sum. There
was no way to say a market was under- or over-served, because there was nothing to
divide by.

### Now

```
                     ┌─ reference/ ────────────────────────────┐
                     │  ACS 2023 demand   (ZCTA · county · CBSA)│
                     │  OMB CBSA 2023 delineation               │
                     │  ZIP→ZCTA→county→CBSA crosswalks         │
                     │  ZCTA centroids (Census Gazetteer)       │
                     └──────────────────┬──────────────────────┘
                                        │
platform feeds → site rows ─────────────┼──► scripts/build_markets.py
                                        │        │
                                        │        ├─ geography join   (1,492 of 1,547 sites)
                                        │        ├─ plausibility guard (17 sites held back)
                                        │        ├─ market × category roll-up
                                        │        ├─ trade-area rings (9,667 ZIPs)
                                        │        └─ whitespace scoring
                                        │
                                        ▼
                     dashboard/data/markets.js      → markets.html  (Market Command)
                     dashboard/data/sites_geo.js    → site-level join, for the map
                     build_report.json              → QA, every run
```

Four layers, each with one job:

| Layer | Job | Files |
|---|---|---|
| **Reference** | Federal geography and demand. Refreshes annually, not weekly. | `reference/*.json` |
| **Transform** | Join, guard, aggregate, score. Deterministic, stdlib-only, ~2s. | `scripts/build_markets.py` |
| **Contract** | What a metric means and when it must be blanked. | `METRICS.md` |
| **Presentation** | Reads the built data; computes nothing consequential. | `dashboard/markets.html` |

That separation is the point. The dashboard used to compute revenue and coverage in
JavaScript, which meant a number could differ between two pages and nobody would
know which was right. Now derived numbers are computed once, in one place, and the
UI renders them.

---

## The three findings from this build that matter most

**1. The dataset had two live data-integrity bugs, and they were material.**

Eleven sites carried impossible capacity — one Jackrabbit gym read **166 billion
seats**. Unguarded, national capacity was 170 billion instead of ~391,000, which
means the "Total capacity" and any fill-rate figure on the existing hub and map
pages were meaningless. Separately, two iClassPro sites carried enrollment of 15,822
and 7,197 (median site: 270), together holding **12% of national enrollment and
$38M of estimated revenue**, and two more had monthly prices of $1,280 and $795 that
are plainly term or annual figures mislabeled as monthly.

Removing all seventeen drops estimated national annual tuition from **$375M to
$307M — an 18% correction.** These are now flagged by an explicit guard with
documented thresholds, surfaced on a Data quality tab, and never silently deleted.
Both root causes are worth chasing upstream: the capacity blowups are all
`observed_max` on Jackrabbit (a max-openings derivation reading a non-count field),
and the enrollment blowups are all `observed_max` on iClassPro (almost certainly
class-occurrence double counting rather than distinct students).

**2. Coverage is not uniform, and uniform-looking numbers were hiding it.**

Only 62% of enrollment-reporting sites actually report enrollment; 14% are geocoded
to a street address, the rest to a ZIP or city centroid. Adventure parks and STEM
publish no enrollment at all — that is their billing model, not a gap, so they are
now excluded from coverage scoring rather than penalised by it. Every market now
carries an A/B/C/N confidence grade, and confidence-C markets are excluded from
ranked screens by default.

**3. Thin observed supply in a big metro is a coverage gap, not an opportunity.**

Detroit shows two gymnastics sites for 391,000 children. Ranked naively, it is the
best whitespace in the country. It is far more likely that Detroit's gyms run on
platforms or paper we have not swept. Those markets are now flagged
`low_observed_supply` and separated from the opportunity ranking. This is the single
easiest way for this dataset to produce a confidently wrong recommendation, so it is
guarded explicitly.

---

## The dashboard, reorganized

Four pages now, with distinct jobs rather than four views of the same table:

| Page | Question it answers | Grain |
|---|---|---|
| `index.html` — Hub | "What have we got?" | National / metro cards |
| **`markets.html` — Market Command** | **"Which markets, and how contested?"** | **CBSA × category** |
| `map.html` — Map | "Where exactly, and what is near my sites?" | Site |
| `programs.html` / `products.html` | "What does this operator sell, at what price?" | Brand / SKU |

Market Command has three tabs matching the three jobs you named:

- **Markets** — competitive share. Stat band, a market map (children-per-site against
  fill rate, bubble = demand, quadrant lines at the medians), and a sortable table
  carrying penetration, fill, price index, HHI, leader and whitespace. Click through
  to a drawer with demand, operator mix, price band and a "what this rests on" block.
- **Trade areas** — site selection. 9,667 ZIP-grain rows inside metros we have supply
  in, filterable by demand, competitor count within 10 miles, and income.
- **Data quality** — the guard rail. What was held back and why, coverage by category.

The load-bearing UI decision: **an absent denominator renders as an em dash, never as
zero.** `GOTCHAS.md` already records what happens when it does not — "$0" and "0 of 0"
read as broken software rather than as absent data, and people stop trusting the tool.

---

## Build sequence from here

Ordered by value per unit of work, not by difficulty.

### 1. Turn on history (highest value, smallest effort)

`METHOD.md` §6 already specifies this and the data schema already has a `snapshots`
array with exactly one entry. Snapshot weekly into `history/`, never re-derive a past
week from a later pull. Four snapshots turns every metric in `METRICS.md` into a
trend, and **trend is what a diligence process actually buys** — a static market map
is a slide, but "these six metros added 9% enrollment in a quarter while these four
shrank" is an investment case. Unleashed stores enrollment per occurrence, so its
brands can be backfilled immediately rather than waiting.

*Effort: a cron job and a directory. Do this first.*

### 2. The ownership layer

For a buy-and-build thesis this is the missing spine. Right now "who owns the six
gyms in Frisco" is unanswerable. Needed per site: franchise vs corporate, franchisee
entity, and a multi-unit operator rollup. Sources: state business registries, the
FDD Item 20 tables franchisors publish annually (these list every franchisee and
unit count), and operator websites. Then the roll-up screen writes itself — fragmented
markets you can already identify by HHI, crossed with operators holding 3+ units.

*Effort: medium. FDD Item 20 is the unlock; it is public and structured.*

### 3. Size the blind spot

The universe is platform-visible supply. You do not currently know whether that is
60% of the market or 95%, and the honest answer to a sponsor is "I don't know yet",
which is a weaker answer than it needs to be. A places-API sweep of a handful of
representative metros — count every gymnastics/martial-arts/swim business, match
against the universe, report the capture rate — converts a caveat into a
quantified coverage figure. You will not get enrollment for the unmatched ones, but
you will be able to say "we see 78% of units in a typical metro", and that single
number materially raises what every other number is worth.

*Effort: small per metro. Do five metros, not fifty.*

### 4. Drive-time trade areas

Replace haversine rings with isochrones. Straight-line distance is fine for ranking a
thousand ZIPs and wrong for choosing between three sites on a shortlist. Open-source
routing (OSRM/Valhalla on OSM extracts) does this without a per-call vendor fee.

*Effort: medium. Only needed once someone is choosing an actual address.*

### 5. Real estate attributes

Square footage, rent, center type, co-tenancy, lease expiry. Partly purchasable
(CoStar, Placer.ai), partly derivable from county parcel data, which is free and
per-county messy. Sequence this after ownership — knowing *who* is in a building
tends to matter more than the building.

### 6. Forward-looking demand

ACS 5-year is backward-looking by construction. County population projections plus
residential building permits (Census BPS, monthly, free) would let you rank markets
by where children *will be*, which is the question a seven-year hold actually asks.

---

## Things to be careful about

**Do not let "share of observed supply" become "market share" in a deck.** It will
happen the first time someone screenshots a table without its footnote. The guard is
to name the column that way everywhere and to keep the caveat inside the data file's
metadata, not only in the UI chrome.

**The seat models are the soft underbelly.** `METHOD.md` §1 is honest about the three
evidence tiers, and the Goldfish validation (+0.6% median deviation against 57
independently measured sites) is genuinely strong evidence — but it validates *one
brand's* model. Every new brand's seat table needs its own cross-check before its
numbers get quoted. The `pct_enrolled_quotable` field exists so that a market's
reliance on modeled enrollment is visible rather than buried.

**Refresh the reference layer annually, not weekly.** ACS publishes each December;
OMB redelineates CBSAs every few years. Pin the vintage in `meta` (it is) so a
year-over-year comparison never silently mixes two delineations.

**Watch for the platforms closing up.** The whole extraction rests on operators
choosing to publish availability. That is a business decision they could reverse.
`METHOD.md` §6 has the right answer already: once a snapshot is in your own
`history/`, no upstream change can take it away. The accumulated series is the moat,
and it starts accumulating the day you turn item 1 on.

---

## Reproducing this build

```bash
cd marketintel
python3 scripts/build_markets.py          # ~2s, stdlib only
open dashboard/markets.html               # needs a local server for the data files
```

`build_report.json` is written on every run: geography join rates, plausibility
flags, confidence mix, and reconciliation checks between the source snapshot and the
roll-up. If `qa_site_reconcile_ok` is ever `false`, a join broke — read it before
trusting anything else in the output.
