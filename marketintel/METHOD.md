# Method

## 1. Turning availability into enrollment

Platforms fall into three tiers. Know which one you are in, and label the output
accordingly — the difference between them is the difference between a number you can
quote and a number you can only rank on.

### Tier 1 — published (best)

The platform gives you both sides. Nothing to model.

- **Unleashed:** `reservationCount` + `availableSlots`
- **Pike13:** `maximum_clients` (published) − `capacity_remaining` (observed)

Label: `published`. Quote these.

### Tier 2 — seat model (iClassPro)

You get `openings` but never capacity. So capacity has to come from the brand's own
published student:teacher ratios, cross-checked empirically:

```
enrolled(class) = max(seats_for_level − openings, 0)
site_estimate   = Σ enrolled × OCCUPANCY_FACTOR
```

**Building the seat table for a new brand:**

1. **Official research.** Level names, age bands, published class size or ratio per
   level. Record URL and confidence per fact. Watch for sub-brands with different caps.
2. **Empirical cross-check.** From your own raw pulls, per level: `n_classes` and the
   **max openings ever observed on a single class** — an empty class exposes its full
   size, so that is a hard lower bound on seats. Reconcile against published.
3. Where multi-site truth exists, prefer **integer seats pinned across sites** over a
   single-site quotient (one site absorbs day-drift noise).
4. Residual error, if uniform, becomes an **occupancy factor**. Swim landed on 0.9514.

Tables for four swim brands are in `data/*_level_seats*.csv` as worked examples of the
format. The columns that matter: `level_token`, `seats_per_class_proposed`, `evidence`
(published/observed/both), `max_openings_observed`, `n_classes_observed`, `confidence`,
`notes`.

**Always exclude** private/semi-private (they are 1 and 2 seats, handle separately),
team practice, clinics, camps, events, open swim/open gym. Team classes especially will
wreck a level's max-openings figure — one had openings up to 20.

Label: `derived`. Rank on these; do not quote the last digit.

### Tier 3 — capacity derived from observation only (Jackrabbit)

No published ratio exists, so capacity per class is, in priority order:

1. private -> 1, semi-private -> 2 (from the class name or tuition tier)
2. brand-published instructor ratio if one exists
3. **max openings ever observed for that level across the whole org**

Then `enrolled = derived_capacity − openings`. Note (3) must be computed across the
whole org *before* you split by location, or a small site never sees an empty class and
its capacity collapses to its own current openings.

Label: `observed_max_only` — the weakest tier. Flag it per row.

### Class-name parsing is where the bodies are buried

Every brand names classes differently and several name them **inconsistently within one
brand**. Real examples that each caused a wrong number:

- The same brand used `Level (Day Time) Lane N` at one account and the reversed
  `Day Time (Level)` at ~40 others. Reading only one order understated a site by 32%.
- Level names carrying internal ops notes: `Seahorse (don't change)`, `Walrus (lane 7)`,
  `Starfish (15 w/ bench)`, `Seahorse (3 student MAX)`.
- Session-type strings that differ per org: `Classes` vs `Dance Classes` vs
  `Weekly Classes - Evenings`. **Always substring-match, never exact-match**, just
  because the first org you tested happened to be clean.

## 2. Enumerating a brand's locations

In rough order of preference:

1. **A structured location feed on their own site.** Aqua-Tots embeds the entire
   national list — slug, address, lat, lng — as a JSON array in `/location-finder/`.
   Check for this first; it saves everything downstream.
2. **Sitemap -> per-page JSON-LD.** `sitemap.xml` (or `location-sitemap.xml`) for the
   URL list, then `<script type="application/ld+json">` on each page for a
   `LocalBusiness`/`SportsActivityLocation` node with `address` and often `geo`.
3. **Derive the platform account from the marketing slug and probe the platform.**
   Best when it works: it validates the account *and* returns the address in one small
   call. 186 accounts in 6 seconds vs 223 heavyweight page fetches.
4. **Scrape the location pages.** Last resort. Slow, rate-limited, and the JSON-LD lies
   more often than you would expect (see `GOTCHAS.md`).

⚠ **A sitemap's `/locations/` pages are not all locations.** One brand's 30 pages were
15 real sites plus schedule and registration pages. Cross-check the count against the
platform (e.g. how many distinct `loc=` codes actually return rows).

## 3. Geocoding

- **Street addresses -> US Census** one-line geocoder. Free, no key, fast, batchable.
  `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=...&benchmark=Public_AR_Current&format=json`
- **City/state only -> Photon** (`photon.komoot.io`). Free, no key, tolerant.
- ⚠ **Nominatim will 429 you hard** — it returned 0 of 103 after earlier use. Do not
  build on it.
- ZIP centroid (`api.zippopotam.us`) is a decent last resort; 1–3 miles of error, which
  is fine for a 10-mile ring but can misclassify a site near the boundary.

**Record precision per row.** A `geo_precision` column (`street` / `jsonld` /
`city_centroid` / `zip_centroid`) keeps soft coordinates visible instead of silently
equal to good ones.

## 4. Rings, and the two filters that make the table usable

```python
enrolled_within = [pool for pool in mine if haversine(site, pool) <= RADIUS]
ring_status     = "in_ring" if enrolled_within else "prospective"
```

**Prospective sites** — no site of yours within the radius — are the map of where the
brands are and you are not. Carry them with enrollment and price, but with **no share
comparison**, because there is no local denominator.

⚠ **Do not write prospective sites into whatever file feeds your share calculation.**
A site with no denominator corrupts every share column. Keep them in a separate file
and join them in at the presentation layer.

⚠ **Any pool-relative metric must be blanked on a prospective row**, or the UI renders
"$0" and "0 of 0" — which looks like broken data rather than an absent denominator.
Replace them with something that stands alone (e.g. "their median lesson price").

**The two filters worth building:**

1. **One row per site (merge, don't hide).** A rival inside several of your rings is one
   business; the paired view lists it once per ring and double-counts it in every total.
   **Merge** the rows and put every pool it touches in one cell — an earlier version
   that just hid all but the nearest row silently misreported which of your sites a
   rival actually competes with. Blank the pool-relative columns on a merged row.
2. **Scope: all / competing / prospective.** Independent of your other filters.

## 5. QA — the part that decides whether any of this is usable

**Validate the estimator against numbers you did not produce.** The swim build's
Goldfish seat model read **+0.6% median deviation** (p10 −0.1%, p90 +7.8%) against 57
sites already measured by an earlier, independent pass. That single check is what made
the other 129 sites trustworthy.

Cheap checks that each caught a real bug:

- **Do your in-ring counts match a prior build's?** Foss 14 and Aqua-Tots 47 matched
  exactly, which validated the ring math without any extra work.
- **Distribution sanity.** Median, p90, max per brand, and fill rate. A brand mean of
  ~1,000 students/site looked wrong until the distribution showed a genuine long tail
  (median 956, max 2,438 at a large urban site, fill 72–80%).
- **Repeated values are a bug signal.** 16 sites sharing one city name, or 30 sites
  sharing one lat/lng, is never real.
- **Coverage %.** Sized-of-total per brand. A brand that drops from 38/38 to 6/30 after
  a refactor has a join problem, not a data problem.

**Label every row with its evidence tier** (`published` / `derived` / `observed_max_only`
/ `estimated`) and carry the observed date. A number without its provenance gets quoted
as fact six weeks later.

## 6. History

Most platforms give you a snapshot, so a trend has to be accumulated — snapshot weekly
into a `history/` directory and never re-derive a past session from a later pull (feeds
stop returning a session once it closes to enrollment, so a late pull reads as a
collapse).

**Unleashed is the exception** — enrollment is stored per occurrence, so past dates
return real history and a trend can be backfilled in a single pull. Check for this on
any new platform by querying the same past date through different window sizes: if the
counts are identical, it is genuine per-date data.

Once a snapshot is in your own `history/`, no upstream change can take it away. That is
the only real insurance against a competitor closing their feed.
