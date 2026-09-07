# Metric Dictionary

Every number this system publishes is defined here — formula, denominator, evidence
tier, and the rule for when it must be blanked. A metric that is not in this file
should not appear in the dashboard.

The organizing principle: **a metric is only as good as its denominator.** Before
today the dataset had none. Everything below exists to make the denominator explicit
and to stop a number being quoted at a precision it does not have.

---

## 0. The honesty layer (read first)

Three limits apply to everything downstream. They are not caveats to bury; they are
the reason the rest of the numbers are defensible.

**A. This is a census of platform-visible supply, not of the market.**
Sites enter the universe because their brand publishes availability through Unleashed,
iClassPro, Jackrabbit, Pike13 or My Gym. A single-location independent on paper
scheduling is invisible. So:

- `share_*` metrics are **share of observed supply**, never true market share.
- `penetration_*` metrics are **lower bounds**.
- The right framing to an investment committee is "of the organized, platform-run
  supply we can see, X". Anyone who restates that as "market share" has broken it.

**B. Enrollment is estimated for most rows.** `evidence_tier` carries this per site:

| Tier | Meaning | Use |
|---|---|---|
| `published` | Platform gives enrolled and capacity outright | Quote it |
| `class_line_published` | Same, at class-line grain | Quote it |
| `observed_max` | Capacity inferred from the largest emptiness ever seen | Rank on it, do not quote |
| `class_line_modeled` | Seat model from published ratios | Rank on it, do not quote |
| `schedule_only_no_capacity` | Classes seen, no capacity signal | Counts only |
| `price_only` | Price, no enrollment | Excluded from enrollment metrics |

Any market roll-up carries `evidence_mix` — the share of its enrollment by tier.

**C. One snapshot is not a trend.** All current data is the week of 2026-09-07.
Nothing in this file is a growth rate. Growth metrics get defined when `history/`
has four or more snapshots.

---

## 1. Geography — how a market is defined

| Field | Definition |
|---|---|
| `zcta` | 5-digit ZIP Census Tabulation Area. The trade-area unit. |
| `county_fips` | 5-digit state+county. From ZIP→ZCTA→dominant-county by land area, or reverse-geocoded from lat/lng. |
| `cbsa` | OMB Core Based Statistical Area code (2023 delineation). **The market unit.** |
| `market_type` | `metro` / `micro` / `non_cbsa` (rural counties get a `county:<fips>` pseudo-market) |
| `geo_precision` | `location` (street) / `zip_centroid` / `city_centroid` / `ungeocoded` |
| `geo_method` | `zip_xwalk` / `latlng_reverse` / `unresolved` |

Why CBSA and not the free-text `metro` field: the old field was blank on 32% of sites
and had no population attached to it. CBSA is a federal standard, so demand data joins
to it directly and the results are comparable to any other market study.

**Blanking rule:** a site with `market_type = null` is excluded from every market
roll-up and reported separately in the unassigned count. It is never silently dropped.

---

## 2. Demand — the denominators

Source: ACS 2023 5-year estimates (tables B01001, B19013, B11005), at ZCTA, county
and CBSA. No API key, no license, refreshes annually.

| Field | Definition |
|---|---|
| `kids_0_14` | Children under 15. **The primary denominator** for youth enrichment. |
| `kids_5_14` | Children 5–14. Secondary denominator for martial arts / STEM / ninja, which skew school-age. |
| `kids_0_4` | Under 5. Relevant to swim, The Little Gym, Tumbles. |
| `households` | Total occupied households |
| `hh_with_kids` | Households with one or more people under 18 |
| `median_hh_income` | Median household income |
| `income_index` | `median_hh_income / national_median` × 100. 100 = national average. |

**Margin-of-error rule:** ACS estimates at ZCTA level carry real error. Any trade area
with `kids_0_14 < 500` is flagged `thin_demand` and excluded from ranked screens.

---

## 3. Supply — counts

Computed over **visible** sites only: `likely_closed = false` and `is_junk = false`.

| Metric | Formula |
|---|---|
| `sites` | count of visible sites |
| `brands` | distinct brand count |
| `enrolled_observed` | Σ `enrolled` |
| `capacity_observed` | Σ `capacity` |
| `est_annual_rev` | Σ `est_annual_rev` (revenue-eligible rows only) |

### Coverage — always published beside the metric it qualifies

| Metric | Formula | Purpose |
|---|---|---|
| `cov_enrollment` | sites with `enrolled > 0` ÷ sites | How much of the market the enrollment number actually saw |
| `cov_price` | sites with `price_low` ÷ sites | Same for pricing |
| `cov_revenue` | sites with `revenue_eligible` ÷ sites | Same for revenue |
| `cov_street_geo` | sites with `geo_precision = location` ÷ sites | Whether the map dots are real addresses |
| `confidence` | `A` if cov_enrollment ≥ 0.70 and sites ≥ 5; `B` if ≥ 0.40; `C` otherwise | Single gate for quotability |

**Blanking rule:** confidence `C` markets render their derived metrics greyed and are
excluded from every ranked list by default. A rank built on 2 of 11 sites is noise
wearing a number's clothes.

---

## 4. Density and penetration

| Metric | Formula | Reads as |
|---|---|---|
| `sites_per_100k_kids` | `sites ÷ kids_0_14 × 100,000` | Supply intensity. National mean is the reference line. |
| `kids_per_site` | `kids_0_14 ÷ sites` | Same thing inverted; the number an operator intuits. High = underserved. |
| `penetration_observed` | `enrolled_observed ÷ kids_0_14` | Share of local children enrolled **in supply we can see**. A floor, never a ceiling. |
| `penetration_adjusted` | `penetration_observed ÷ cov_enrollment` | Grosses up for sites in the universe that reported no enrollment. Still a floor on the true market. |
| `spend_per_kid` | `est_annual_rev ÷ kids_0_14` | Captured annual tuition dollars per resident child. |
| `spend_per_enrolled` | `est_annual_rev ÷ enrolled_observed` | Effective annual ticket. Sanity-checks the revenue model — implausible values mean a billing-model join broke. |

**Blanking rule:** every metric in this table is blanked when `kids_0_14` is null or
the market is `confidence C`. Do not render `0%` — an absent denominator must look
absent, not zero. (This is the same failure mode `METHOD.md` §4 flags for prospective
sites rendering "$0".)

---

## 5. Competitive structure — the share metrics

**Computed within category.** Urban Air and a gymnastics gym are not competitors for
the same enrollment dollar, so a share figure mixing them is meaningless. Categories:
`gymnastics`, `martial_arts`, `adventure`, `stem`, `ninja`, `cheer_dance`.

| Metric | Formula |
|---|---|
| `share_enrolled_brand` | brand's `enrolled` in market-category ÷ category total |
| `share_sites_brand` | brand's sites ÷ category sites |
| `cr4` | Σ of the top four brands' `share_enrolled` |
| `hhi` | Σ (`share_enrolled_brand` × 100)² over all brands in the market-category |
| `top_brand`, `top_brand_share` | Largest by enrolled |

**Reading HHI** — the standard antitrust bands, used here as a roll-up screen:

| HHI | Structure | What it means for a buy-and-build |
|---|---|---|
| < 1,500 | Fragmented | Many small operators. Best consolidation candidates. |
| 1,500 – 2,500 | Moderately concentrated | A leader exists; entry is contested. |
| > 2,500 | Concentrated | One or two operators own it. Buy in or stay out. |

HHI here is computed on *observed* supply, so a fragmented reading is reliable
(fragmentation can only be understated by missing independents) while a concentrated
reading is soft (the missing independents would push it down). Directionally safe in
one direction only — say so when quoting it.

**Blanking rule:** `hhi` and `cr4` require ≥ 3 brands with enrollment in the
market-category. Below that, report brand names, not a concentration figure.

---

## 6. Pricing

| Metric | Formula |
|---|---|
| `price_median` | Median `price_monthly_equiv` across priced sites |
| `price_p25`, `price_p75` | Interquartile range — the local price band |
| `price_index` | market-category `price_median` ÷ national category `price_median` × 100 |
| `price_headroom` | `price_p75 − price_median` — how far the local ceiling sits above the middle |

`price_monthly_equiv` normalizes billing models (perpetual monthly, term session,
per-lesson package) to one monthly figure. Rows where `billing_model = unknown`
(350 sites today) are excluded from every price metric and counted in `cov_price`.

---

## 7. Utilization — the tightest site-selection signal

| Metric | Formula |
|---|---|
| `fill_rate` | `enrolled_observed ÷ capacity_observed`, over sites where both are present |
| `open_seats` | `capacity_observed − enrolled_observed` |
| `sites_at_capacity` | count of sites with `fill_pct ≥ 0.90` |

A market where incumbents are running at 85%+ fill is a market with unserved demand:
customers are being turned away or waitlisted, and a new unit does not have to take
share to fill. This is the single most actionable number in the system for new builds,
and it is available *because* the platforms publish availability.

**Blanking rule:** requires ≥ 3 sites with both enrolled and capacity.

---

## 8. Whitespace score — a screen, not a forecast

A 0–100 composite for ranking where to build next. It is a **percentile blend**, which
means it says "this market is more attractive than that one on these four axes" and
nothing about absolute returns.

```
whitespace = 100 × mean(
    pctile(kids_0_14),            # is there enough demand to matter
    1 − pctile(sites_per_100k),   # is it underbuilt relative to that demand
    pctile(fill_rate),            # is existing supply already full
    pctile(median_hh_income)      # can households pay
)
```

Equal weights, deliberately. A weighted version implies a precision the inputs do not
support; if you want to weight it, weight it in the open on the screen, not inside the
formula. Percentiles are computed across markets **within the same category** and only
over confidence A/B markets.

**A component that is null drops out and the mean is taken over the rest**, with
`whitespace_components_used` published alongside. A score built on two of four axes is
labeled as such.

---

## 9. Trade-area metrics (ZCTA grain, for site selection)

Computed for every ZCTA inside a metro CBSA with `kids_0_14 ≥ 500`.

| Metric | Definition |
|---|---|
| `sites_5mi`, `sites_10mi` | Competitor sites within radius (straight-line) |
| `enrolled_10mi`, `capacity_10mi` | Observed enrollment and seats in the ring |
| `kids_per_site_10mi` | `kids_0_14` of the ring ÷ `sites_10mi` |
| `nearest_competitor_mi` | Distance to closest site in the same category |
| `nearest_same_brand_mi` | Distance to closest site of a chosen brand — the cannibalization check |
| `ta_whitespace` | Same composite as §8, computed across trade areas within the metro |

**Straight-line is a proxy for drive time.** It overstates accessibility across rivers,
highways and downtown grids. For a shortlist of 20 candidates, replace it with real
isochrones before anyone signs a lease. Flagged in the output as `distance_method =
haversine`.

---

## 10. What is still missing

Named honestly, because the gaps are where the next value is:

1. **Time series.** One snapshot. Weekly accumulation into `history/` turns every
   metric above into a trend, and trend is what a diligence process actually buys.
2. **Ownership.** No franchisee-vs-corporate flag, no multi-unit operator rollup. For
   a buy-and-build thesis this is the missing spine — "who owns these 6 gyms" is
   currently unanswerable.
3. **Real estate attributes.** Square footage, rent, center type, co-tenancy, lease
   expiry. Partly purchasable, partly derivable from parcel data.
4. **Drive-time isochrones.** See §9.
5. **Independent operators off-platform.** The known blind spot in §0A. Partly
   addressable with a places-API sweep to size what is missing, even without
   enrollment for it.
6. **Demand growth.** ACS 5-year is backward-looking. County population projections
   and building-permit data would add the forward-looking half.
