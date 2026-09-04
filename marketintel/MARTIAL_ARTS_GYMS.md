# Martial arts studios and gyms — the on-ramp

## Start here: Premier Martial Arts is already readable

Unleashed Brands runs one shared backend across its whole portfolio, and **Premier
Martial Arts is brand 4 on it with 308 US locations**. Verified live on 2026-09-03,
unauthenticated, from a plain server-side request:

```
GET https://unleashedapi.urbanairparks.com/brands/4/parks
GET https://unleashedapi.urbanairparks.com/brands/4/parks/{parkId}/events/calendars?fromDate=&toDate=
GET https://unleashedapi.urbanairparks.com/brands/4/parks/{parkId}/products?productTypeIds=1&productTypeIds=7
```

A 12-location sample returned:

| Location | Classes | Enrolled | Capacity | Membership from |
|---|---|---|---|---|
| Hinsdale, IL | 22 | 200 | 484 | $164/mo |
| Aventura, FL | 57 | 177 | 624 | $199/mo |
| Houston Heights, TX | 26 | 241 | 549 | $234/mo |
| North Knoxville, TN | 22 | 69 | 440 | $114/mo |

**4 of 12 had live class schedules; 10 of 12 had membership pricing.** So pricing
coverage will be near-complete across all 308 and enrollment will be partial — which
still gives you a national price map on day one.

This is the single best starting point because `reservationCount` and `availableSlots`
are **published outright**. No seat model, no capacity inference. That is rare.

Run: `python3 scripts/unleashed.py pull 4 --weeks 1 --out pma.json`

### Two quirks to expect

- **`Z ` prefixed locations are dead** (`Z Aiken, SC`, `Z Murrysville, PA`). They return
  zero classes but still carry products. Filter them out or you will report closed
  studios as zero-enrollment ones.
- A location with **1 product at ~$954–$1254/mo** is not a monthly membership — it is an
  annual or paid-in-full plan. Take the *minimum* active product as the comparable
  monthly rate, and check the billing interval field.

## The rest of the Unleashed portfolio

Same API, swap the brand id. All confirmed present 2026-09-03:

| id | Brand | Locations | Classes? |
|---|---|---|---|
| 1 | Urban Air | 242 | no classes product |
| 2 | Snapology | 185 | migrating |
| 3 | The Little Gym | 349 | migrating |
| **4** | **Premier Martial Arts** | **308** | **live** |
| 5 | Class 101 | 84 | no classes product |
| 7 | Sylvan Learning | 640 | migrating |
| 8 | Water Wings Swim School | 21 | live |

The Little Gym (349) is the other one worth watching — children's gymnastics/fitness,
directly adjacent to your side project, and migrating onto the platform now. Re-check
`hasClasses` and sample a few parks every couple of months.

## Platforms to expect in martial arts and gyms

The swim vertical ran on four platforms. Martial arts and fitness overlap on two of
them and add several of their own. In rough order of how likely you are to hit them:

**Already covered by this kit:**

- **Jackrabbit Class** — built for gymnastics, dance, cheer, swim and **martial arts**.
  Public `OpeningsJS` feed, no login. `scripts/jackrabbit.py` works as-is.
- **iClassPro** — same market, same story. Public open API. `scripts/iclasspro.py`.
- **Pike13** — this one is *fitness-first*. Aqua-Tots used it, but its core market is
  gyms, CrossFit boxes, yoga and martial arts. Expect to hit it often.
  `scripts/pike13.py`.

**Not yet explored — likely, and worth a morning each:**

- **Mindbody** — the giant in boutique fitness. Has a public-ish widget/booking layer;
  its class schedules are embedded on operator sites. Highest-value unknown.
- **Zen Planner** — very common in martial arts and CrossFit specifically.
- **Kicksite**, **RainMaker / ChampionsWay**, **Spark Membership**, **Atlas Up** —
  martial-arts-specific studio software.
- **PushPress**, **Wodify**, **TeamUp**, **Glofox / ABC Fitness** — box and studio side.
- **WellnessLiving**, **Momence**, **Arketa** — newer, growing fast.

The method for a new platform is always the same and takes an hour:

1. Find an operator's booking or schedule page.
2. Open it in Chrome, patch `window.fetch` **before** the app loads (or read
   `performance.getEntriesByType('resource')` after it does — that one always works).
3. Find the XHR that returns the schedule. Read its field names.
4. Try the same URL from `curl`/`urllib` with a browser User-Agent. If it returns 200,
   you have a pipeline. If it 403s, check whether an `Origin`/`Referer` header fixes it
   before assuming you need a session.

`performance.getEntriesByType('resource')` is the trick that found the Unleashed
membership endpoint after a `fetch` patch came back empty — the page had already loaded.

## Chains worth naming

**Martial arts (franchise, so likely on one shared platform per brand):** Premier
Martial Arts (confirmed), ATA Martial Arts / Songahm, Tiger Schulmann's, Gracie
Barra, Kids 'N Play, Sports Academy, iLoveKickboxing, Title Boxing Club, 9Round.

**Kids gyms / fitness (closest to the swim model — recurring class enrollment, same
parent buyer):** The Little Gym (349, Unleashed), My Gym, Romp n' Roll, Gymboree Play
& Music, Tumbles, JW Tumbles.

The kids-gym set is the better analogue to swim than adult fitness is: recurring
enrollment, level progression, capacity-constrained classes, one parent making the
buying decision. Adult gyms are membership-and-access businesses whose "capacity" is
not a class seat, so most of `METHOD.md` will not transfer cleanly.

## A framing difference from the swim build

The swim build existed to measure rivals around **62 existing pools**. If this side
project is about **where to open**, invert the output: you do not need a share
calculation at all, you need density and price by market. Which means:

- Skip the ring classification entirely, or set the radius to whatever a real
  catchment is for the format (martial arts pulls a much tighter radius than swim).
- Rank by **market saturation** — sites and total enrolled per capita in a metro —
  rather than by share against a pool you do not have.
- Price dispersion within a metro is the interesting signal. In swim, brand price
  varied *per metro* far more than per brand (Goldfish Langhorne $25 vs Frisco $34).

The "Prospective" pattern from the swim build is exactly this and is already built:
sites with no pool of ours within the ring, carried with enrollment and price but no
share comparison. See `METHOD.md`.
