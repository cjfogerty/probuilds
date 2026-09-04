# Competitor Intel Kit

Everything learned building the Big Blue national competitor universe (Sept 2026),
packaged so the same thing can be done for another vertical — martial arts studios,
gyms, or anything else that sells recurring classes to kids.

The swim build ended at **561 US sites, 543 with an enrollment figure (366,172
students), 543 with a list price**, across 8 brands and 4 booking platforms. None of
it required a login, a scraper that pretends to be a browser, or a single credential.

**If you are starting the martial arts / gym project, read `MARTIAL_ARTS_GYMS.md` first.**
It has a confirmed live lead you can pull today.

## The one idea worth carrying over

Class-based businesses run on a small number of booking platforms, and **those
platforms publish availability on purpose** so parents can see what has room. That
publication is the whole opening. You are not breaking into anything; you are reading
the same feed the operator pastes into their own website.

Which means the work is never "how do I get in". It is:

1. **Identify the platform** a brand runs on (`PLATFORMS.md`)
2. **Enumerate their locations** and map each to a platform account/org/park id
3. **Pull the class feed** and turn availability into an enrollment estimate (`METHOD.md`)
4. **Geocode and classify** against your own footprint
5. **Sanity-check** the estimate against something you did not produce

Step 2 is usually the hard one, not step 3. Budget your time accordingly.

## What is in here

| File | What it is |
|---|---|
| `MARTIAL_ARTS_GYMS.md` | The on-ramp for the side project: confirmed leads, likely platforms, first moves |
| `PLATFORMS.md` | Per-platform extraction playbook — endpoints, auth, field names, quirks |
| `METHOD.md` | Turning availability into enrollment; geocoding; ring classification; dedupe; QA |
| `GOTCHAS.md` | Every trap that cost real time. Read before writing code, not after |
| `scripts/` | Working, generalized Python. No dependencies beyond the stdlib |
| `data/` | Seat-model tables from the swim build, plus the full swim universe as a worked example |

## Scripts

All stdlib-only (`urllib`, `json`, `csv`, `ssl`). No pip install. Each runs standalone
and each is importable.

```bash
python3 scripts/unleashed.py brands                 # list Unleashed brands + ids
python3 scripts/unleashed.py parks 4                # Premier Martial Arts locations
python3 scripts/unleashed.py pull 4 --weeks 1       # enrollment + pricing, whole brand

python3 scripts/iclasspro.py probe gssnaperville    # does this account exist / is it open
python3 scripts/iclasspro.py guess-slugs cities.txt # bulk-probe candidate accounts
python3 scripts/iclasspro.py classes gssnaperville  # full class list
python3 scripts/iclasspro.py tuition gssnaperville  # per-level list price

python3 scripts/jackrabbit.py feed 499027           # whole-org class feed
python3 scripts/jackrabbit.py find-locs 499027 CODES.txt   # validate loc= codes
python3 scripts/jackrabbit.py pull 499027 --loc BMD # one location

python3 scripts/pike13.py discover https://www.example.com/some-location/
python3 scripts/pike13.py pull <subdomain> <client_id>

python3 scripts/geo.py geocode addresses.csv        # Census + Photon fallback
python3 scripts/geo.py rings sites.csv mine.csv --miles 10
```

## A warning that is not boilerplate

Two of the pipeline scripts in the swim repo are **scripts, not libraries** — they run
their main body on import, and one of them silently rewrote a live data file when I
imported it for a helper function. Copy the function you want. Never import a module
you have not checked for an `if __name__ == "__main__"` guard. See `GOTCHAS.md`.

And stay off admin surfaces. The Unleashed platform publishes a full OpenAPI spec that
documents accounting reports, customer contact records and payment tokens alongside the
public endpoints. Those are other people's customer data. Everything in this kit reads
only what the operator's own public website reads.
