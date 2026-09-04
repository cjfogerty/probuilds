# Platform playbook

Four platforms, all read without a login. For each: how to enumerate locations, how to
pull classes, what is and is not published, and what breaks.

---

## Unleashed Brands (`unleashedapi.urbanairparks.com`)

**The best of the four.** Publishes enrolled AND capacity outright, so no seat model.

**Auth:** none. Works from plain `urllib` with a browser User-Agent. No `Origin` check —
a bogus origin still returns 200. Cloudflare in front of Azure; the only filter is a
crude User-Agent blocklist that rejects the bare `Python-urllib/3.x` string. Set any
browser UA and it passes.

```
GET /brands                                        -> all brands + ids + hasClasses
GET /brands/{brandId}/parks                        -> locations: uuid, urlSlug, address.zipCode, phone
GET /brands/{brandId}/parks/{parkId}/events/calendars?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD
GET /brands/{brandId}/parks/{parkId}/products?productTypeIds=1&productTypeIds=7
```

**Class record** (`data[]`): `name` ("Instructor - Level"), `ageRange`,
`minimumAgeInMonths`/`maximumAgeInMonths`, `description` (carries students-per-lane),
`price`, `requiresMembership`, `isCamp`/`isIntro`/`isClass`/`isSeries`,
`isOnlineRegistrationAllowed`, `categoryId`, `details[]`.

**Detail record** (`details[]`) — the numbers:
- `reservationCount` = **enrolled**
- `availableSlots` = **open seats**. Capacity = the sum of the two.
- `availableIntroSlots` = **trial seats open**. A direct read on whether a site is
  closed to new trials — no other platform gives you this.
- `startDate` = when the series began (tenure), `endDate`, `dayMask`, `heldForWaitlist`
- `startTime`/`endTime` as **decimal hours** (18.75 = 6:45pm)

**Products** (pricing): field is `parkProductName`, not `name`. `price`,
`billingInterval`, `productLevelName`, `isActive`. The bare `/products` call returns
`{"data":[]}` — **the `productTypeIds` params are required**.

**Enrollment is per-occurrence, so history is backfillable in one pull.** Verified:
identical dates queried through three different window sizes return byte-identical
counts, while ~20% of series vary across their own occurrence dates. Data starts at
each brand's platform migration and runs 1+ year forward.

⚠ **Use a strict 7-day window.** A wider range repeats each series once per occurrence —
a 90-day pull inflates enrollment ~12x. Dedupe on the detail `id` or keep to one week.

⚠ The public site's schedule page **hides full classes**; the API does not. One swim
site showed 231 classes on the website against 879 from the API, 642 of them full.

---

## iClassPro (`app.iclasspro.com/api/open/v1/<account>/...`)

**Auth:** none. "open" is literally in the path — it exists so schools can embed
schedules on their own sites.

```
GET /api/open/v1/{account}/locations                 -> name, address, city, state, zip, phone
GET /api/open/v1/{account}/classes?limit=50&page=N   -> paginate to totalRecords
GET /api/open/v1/{account}/classes/{id}              -> DETAIL: tuition, waitlistEnrollments
GET /api/open/v1/{account}/categories
```
`/programs`, `/levels`, `/instructors` all 404.

**Published:** `openings` (spots left), `futureOpenings`, `instructors` (names),
`levelId`, `schedule[]`. **NOT published: capacity or enrolled** — you must model seats.
See `METHOD.md`.

**Multi-location accounts:** the default `/classes` feed returns location 1 only. Other
physical sites need `?locationId=N`; the list objects lack `locationId` but the detail
endpoint has it.

**Pricing** is on the **detail** endpoint only (`tuition`), not the list. Tuition is set
per level per account, so sample ~2 classes per (account, location, level) and take the
median. ⚠ `tuitionTerm` is unreliable — accounts label a monthly rate "Per Lesson" and
vice versa. **Magnitude decides:** >= $70 is monthly, below is per-lesson x 4.33.

**Status codes are a signal, not just an error:**
- `400 "Organization not found"` -> no such account, your slug guess was wrong
- `403 "Account is frozen"` -> **the account is real but has churned off the platform**
- `200` with `{"data":[],"message":"Please sign in to see classes."}` -> a real, active
  account whose owner switched the public feed OFF. It is a per-account checkbox.

That last one matters: any operator can close their own door in minutes without
involving the vendor. Expect slow erosion, one site at a time, not a cliff.

**Slug guessing works and is fast.** Goldfish accounts are `gss<citySlug>`; SafeSplash
are the dehyphenated marketing slug. Probing 223 candidates against `/locations` took
**6 seconds** and returned 186 accounts *with addresses* — far better than scraping 223
one-megabyte marketing pages, which got rate-limited into 181 failures at 6 workers.

---

## Jackrabbit Class (`app.jackrabbitclass.com/jr3.0/Openings/OpeningsJS`)

**Auth:** none for this feed. (`GetClassesForEnroll` *does* need a parent session and
302s to /Login — but it is not the only way in, and that mistake cost months.)

```
GET /jr3.0/Openings/OpeningsJS?OrgID={org}
GET /jr3.0/Openings/OpeningsJS?OrgID={org}&loc={code}
```

Returns JS that `document.write`s an HTML table. Parse the table, not JSON.

**Published:** class name, days, times, `openings`, `tuition`, class start/end,
session, `register` (`Register` / `Waitlist`). **NOT published: enrolled or capacity.**

**One org can cover many physical locations.** This is the key fact: one parent account
(if you ever need one) covers a whole org, and a national brand may run everything from
a single org. Never create one account per location.

**Two ways an org splits by location — try both:**
1. `&loc=<code>` — a valid code returns a subset, an invalid one returns **0 rows**,
   which makes candidate codes cheap to validate by brute force.
2. A token embedded in the **class name** (`Seahorse SK 10:00a Su`). Some orgs return
   zero on `loc=` and only split this way.

**Finding the loc codes** is the real work. They are often not on the brand's site as
`loc=` links. For Bear Paddle they turned out to be the slugs of the operator's own
`<code>-csl-schedule` pages. Other places to look: a location dropdown on the org's
openings page, registration links, or brute-forcing 3-letter abbreviations of city
names (~6 candidates per city, validated by row count).

---

## Pike13 (`{subdomain}.pike13.com/api/v2/front/...`)

**Auth:** none, but you need the operator's **public `client_id`**, which is embedded in
their own marketing page for the schedule widget.

```
# 1. scrape the location page for the client_id
regex: https?://([a-z0-9-]+)\.pike13\.com/api/v2/front/[^"']*client_id=([A-Za-z0-9]+)

# 2. then, unauthenticated:
GET https://{sub}.pike13.com/api/v2/front/services.json?client_id={cid}
GET https://{sub}.pike13.com/api/v2/front/event_occurrences.json?client_id={cid}&from=&to=
GET https://pike13.com/api/v2/front/plan_products?client_id={cid}
```

**Published:** `services.json` gives `maximum_clients` (**published capacity**) and
pricing. `event_occurrences.json` gives `capacity_remaining` as an **integer** plus
`state` and `waitlist`.

So: `enrolled = maximum_clients - capacity_remaining`. Observed openings against a
published capacity — **stronger evidence than a seat model, on a par with the
best iClassPro reads.**

⚠ An older note in the swim project said Pike13 exposed "only a yes/no availability
flag" and could not be sized. **That was wrong** and it blocked the brand for months.
The binary flag is what the *rendered widget* shows; the API underneath returns
integers. If a platform looks unsizeable, check the API, not the UI.

⚠ **Pricing: `base_price` is an OBJECT containing `price_cents`**, not a number.
`((service.get("pricing") or {}).get("single_visit") or {}).get("base_price").price_cents / 100`

Pike13's core market is fitness — expect it constantly in gyms and martial arts.

---

## Custom / operator-built APIs

One swim brand (Foss) ran its own API needing a logged-in session, extracted by
injecting JS into an authenticated browser tab. That is the fallback of last resort:
one credential, one ops action away from being revoked, and no warning when it is.

If you must, note the failure mode is a **ban, not an API change** — so it fails
suddenly and totally rather than degrading. Never let a large block of coverage sit
behind a single credential without knowing that is what you have done.
