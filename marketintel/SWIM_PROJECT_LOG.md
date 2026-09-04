# The swim build — what was actually done, as a worked example

Reference for what "finished" looked like, so the martial arts build has a shape to
aim at. Big Blue Swim School, Sept 2026.

## Outcome

**561 US competitor sites** (from a starting universe of 241 within 10 miles of our
62 pools), of which **367 are "Prospective"** — markets where those brands operate and
we do not.

- **543 sites sized: 366,172 students** (118,082 in-ring, 248,090 prospective)
- **543 sites priced**
- Delivered as two data files plus two filters on an existing dashboard

| Brand | Sites | Sized | Enrolled | Median $/lesson | Platform |
|---|---|---|---|---|---|
| Goldfish | 186 | 182 | 182,492 | $33.00 | iClassPro (seat model) |
| Aqua-Tots | 144 | 141 | 88,954 | $31.00 | Pike13 (published cap) |
| SafeSplash | 101 | 99 | 23,873 | $34.75 | iClassPro (seat model) |
| Foss | 35 | 34 | 34,694 | $32.00 | operator API / history |
| British | 38 | 38 | 8,040 | $34.64 | Jackrabbit |
| Emler | 22 | 22 | 12,882 | $32.00 | iClassPro (seat model) |
| Water Wings | 20 | 12 | 7,954 | $32.33 | Unleashed (published) |
| Bear Paddle | 15 | 15 | 7,283 | $41.57 | Jackrabbit |

## Roughly how the time went

Not evenly, and not where I expected:

1. **Platform identification** — fast. A sitemap and one network trace per brand.
2. **Location enumeration and account mapping** — *the bulk of the work.* Every brand
   needed a different route in, and this is where all four data-quality defects came
   from.
3. **Enrollment extraction** — fast once the accounts were mapped, because the seat
   models already existed from earlier work.
4. **Pricing** — one long unattended run (42,333 class-detail calls, ~18 min) plus
   three small per-platform pulls.
5. **Geocoding** — minutes.
6. **UI and integration** — a couple of hours, and one of the two filters had to be
   rebuilt after it shipped wrong.

If you budget for the martial arts build, put the time into step 2.

## Sequence that worked

```
brand sitemap / location finder      -> candidate location list
  -> derive platform account/org/park id, validate live
  -> pull classes (+ tuition) per account
  -> apply the platform's enrollment method
  -> geocode -> classify against your own footprint
  -> QA against any independent prior measurement
  -> write ONE file of sites + ONE file of (yours, theirs) pairs
  -> presentation layer joins them in
```

## The four defects that shipped or nearly shipped

Worth reading as a list of things to check for, not as history:

1. **16 of 30 sites geocoded to the wrong state** — their JSON-LD returned the
   corporate head office. Shipped, caught a day later, fixed by using URL slugs.
2. **A "one row per site" filter that hid rows instead of merging them** — collapsed
   correctly but misreported which of our pools a rival competes with. Shipped, caught
   by the user, rebuilt as a merge.
3. **A live data file rewritten by an import** — a pipeline module with no
   `__main__` guard ran its main body when imported for a helper. Caught before commit.
4. **A deploy dispatched before the push landed**, shipping the previous commit and
   reporting success. Caught by checking the run's `headSha`.

Three of the four were data-provenance problems, not logic problems. The code was
mostly right; what it was fed, or what it quietly overwrote, was not.

## What made the numbers trustworthy

One check, done once: the Goldfish seat model read **+0.6% median deviation** against
57 sites measured by an earlier independent pass. That single comparison is the reason
the other 129 Goldfish sites could be quoted.

Find the equivalent for the martial arts build early — some subset you can measure two
independent ways — and do it before building anything on top.

## Things I would do differently

- **Enumerate from the platform, not the marketing site,** wherever the platform has a
  locations endpoint. Every geocoding defect came from brand pages.
- **Count the sites two ways before trusting either.** A sitemap's `/locations/` pages
  and the platform's distinct location codes disagreed 30 vs 15.
- **Decide the "prospective" data model on day one.** Retrofitting a no-denominator row
  into a share-based schema is where the "$0 / 0 of 0" UI bug came from.
- **Check whether missing data is absent or just differently keyed.** Five of six
  "missing" prices were in the file under longer slugs; the sixth was a site that has
  not opened yet.
