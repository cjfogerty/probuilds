# Gotchas

Every one of these cost real time or shipped a wrong number. Roughly ordered by how
badly it bit.

## Code that runs when you import it

Two pipeline modules in the swim repo have no `if __name__ == "__main__"` guard and
execute their main body on import.

Importing one for its class-name parser **re-ran its main body and rewrote a live data
file** — it changed a site from 617 to 600 while leaving `observed_date` at the old
date, so the date would have lied. Another runs a `ThreadPoolExecutor` at module level.

**Copy the function you want. Check for the guard before importing anything.**

```bash
tail -3 some_pipeline_script.py   # takes two seconds
```

## JSON-LD on marketing pages lies

One brand's location pages returned the **corporate head office address** in their
JSON-LD for 16 of 30 pages, and mismatched a 17th (a page for one city returned another
city's address). The result shipped: 16 sites geocoded to the wrong state.

Another brand embedded a **placeholder lat/lng — the identical coordinate on all 30
sites**.

**Sanity-check before trusting:** count distinct cities and distinct coordinates. If 16
sites share a city, or 30 share a lat/lng, it is wrong. Prefer the URL slug or the
platform's own `/locations` response over page metadata.

## The UI is not the API

- A schedule page showed **231 classes**; the API returned **879** for the same week,
  because the page hides full classes. Reading the site by eye saw a quarter of the
  business and a badly skewed utilization.
- Pike13 was written off for months as "binary availability only, cannot be sized". The
  rendered widget shows a yes/no flag; **the API underneath returns integers**.

**If a platform looks unsizeable, inspect the network calls before concluding anything.**

## Query windows that silently multiply

A per-occurrence enrollment feed repeats each series once per occurrence in range. A
90-day window inflated total enrollment **~12x** with no error and no obvious tell.

Use a 7-day window, or dedupe on the occurrence/detail id.

## Concurrency gets you rate-limited into silence

Fetching 223 pages at 6 workers produced **181 failures** — and the retry loop reported
them as "no address found", not as throttling. The same data came back in 6 seconds
from a small API instead.

Prefer a small structured endpoint over a big page. When you must fetch pages, use 2–3
workers and distinguish an HTTP failure from a parse failure in your output.

## Field names that are almost right

- Unleashed products: the field is **`parkProductName`**, not `name`.
- Unleashed parks: address carries only **`zipCode`** — no street, no city, no coords.
- Pike13: **`base_price` is an object** containing `price_cents`, not a number.
- Unleashed `/products` needs **`?productTypeIds=1&productTypeIds=7`** — without the
  params it returns an empty array rather than an error.

Each of these produced "0 priced" and looked like an access problem rather than a typo.

## Slug joins across two sources

Joining a pricing file to a location list on slug failed for half the rows because the
pricing slugs carried a **full state name and a ZIP** (`blaine-minnesota-55449`) while
the location keys were bare (`blaine`). A two-letter-state strip caught some; only
**token-overlap matching** caught the rest (`chicago-lakeview-illinois-60657` ->
`lakeview`, `foss-swim-school-in-parker-co` -> `parker`).

Before scraping to fill a gap, check whether the record is already there under a
different slug. Five of six "missing" sites were.

## Status codes carrying meaning

On iClassPro, `403 "Account is frozen"` means a **real account that churned off the
platform** — not an access failure. Two sites had been sitting in a backlog as
"unreadable" when they had actually migrated. `400` means the slug is wrong.

A pull that flips `200 -> 403 frozen` is a migration event worth noticing on its own.

## Filters that hide instead of merge

A "one row per site" toggle implemented as a **filter** (keep the nearest row, drop the
rest) collapses the table correctly but then shows one location in a cell that should
list several — silently misreporting which of your sites a rival competes with.

**Merge the group; do not hide its members.** And when you merge, blank the columns that
are only meaningful against a single one of your locations.

Related: a status line that counted merged pool *strings* reported "84 pools" against a
real 62.

## Absent data that is not a failure

One site had no price because **it is not open yet** — its page carries no dollar figure
at all. It had been recorded as an extraction gap. Similarly, an all-future-dated term
reads as an empty feed by design; re-pull when the term starts.

Before building a scraper to fill a hole, check whether there is anything there.

## Background jobs

- A `pgrep -f <name>` waiter **matches its own command line** and therefore never exits.
  Wait on a PID (`kill -0 $PID`) instead.
- Piping a long job through `tail` buffers all its progress output until it finishes, so
  a healthy job looks hung.
- `nohup ... &` inside a tracked background call returns immediately and the harness
  reports "completed" while the real work continues detached.

## Deploys

Dispatch **after** confirming the push landed. A failed push followed by an immediate
workflow dispatch deploys the *previous* commit and reports success. Check
`git status -sb` shows no "ahead", and confirm the run's `headSha` matches your commit.

If the deploy syncs a whole tree, do not run two concurrently.
