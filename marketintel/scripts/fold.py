#!/usr/bin/env python3
"""Fold platform pulls into the dashboard data pack.

This is the step the repo is missing. `iclasspro.py`, `jackrabbit.py`, `pike13.py`
and `unleashed.py` all produce collector output, and `dashboard/data/sites.js`
consumes a unified pack — but nothing in the repo joins the two. `sites.js` meta
even names its input (`data/sites_unified_v2.json`) and that file is not here, so
today the fold only exists inside Intel Snatcher's session.

fold.py takes collector output, normalises it, dedupes against the current pack,
assigns a CBSA metro, labels evidence per METHOD.md, and rewrites BOTH data files
from ONE build stamp — which also closes the "two pull weeks on one dashboard"
bug in the review.

    python3 fold.py plan   --pull pulls/2026-09-13/          # what would change
    python3 fold.py apply  --pull pulls/2026-09-13/ --write  # do it
    python3 fold.py verify                                   # assertions only

Collector output goes in --pull as one JSON per platform:
    pulls/<date>/iclasspro.json   {"accounts": [ {...probe+classes+tuition...} ]}
    pulls/<date>/jackrabbit.json  {"orgs":     [ {...summarise() output...} ]}
    pulls/<date>/pike13.json      {"sites":    [ {...pull() output...} ]}
Anything a collector did not produce is left null, never invented.
"""
import argparse, datetime, hashlib, json, os, re, shutil, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from metro import assign as assign_metro, haversine   # noqa: E402

DASH = os.path.join(HERE, "dashboard", "data")
SITES_JS = os.path.join(DASH, "sites.js")
PRODUCTS_JS = os.path.join(DASH, "products.js")
HISTORY = os.path.join(HERE, "history")

# Evidence tiers. THREE vocabularies exist in this project and none of them agree:
#   METHOD.md    published / derived / observed_max_only / estimated
#   sites.js     published / price_only / observed_max / schedule_only_no_capacity
#   products.js  product_catalog / class_line_modeled / class_line_published /
#                class_line_schedule_only
# fold.py owns the crosswalk so the drift stops here. CANON is what gets written;
# ACCEPT is what may be read without failing verification.
CANON = ["published", "derived", "observed_max_only", "price_only",
         "schedule_only_no_capacity", "estimated"]
CROSSWALK = {
    "observed_max": "observed_max_only",           # sites.js spelling
    "class_line_published": "published",
    "class_line_modeled": "derived",
    "class_line_schedule_only": "schedule_only_no_capacity",
    "product_catalog": "price_only",               # sticker, no enrollment
}
TIERS = set(CANON) | set(CROSSWALK)


def canon_tier(t):
    """Normalise any of the three vocabularies to CANON. Unknown values raise."""
    if t in (None, ""):
        return None
    t = CROSSWALK.get(t, t)
    if t not in CANON:
        raise ValueError(f"unknown evidence_tier {t!r}")
    return t
PLATFORM_TIER = {
    "pike13": "published",        # maximum_clients − capacity_remaining
    "unleashed": "published",     # reservationCount + availableSlots
    "iclasspro": "derived",       # seat model over openings
    "jackrabbit": "observed_max_only",
}
DUPE_KM = 0.25   # two records this close with a similar name are one business


# ---------------------------------------------------------------- load / save

def _read_js(path, var_prefix):
    raw = open(path).read()
    if not raw.startswith("window."):
        raise SystemExit(f"{path} does not look like a data pack")
    return json.loads(raw.split("=", 1)[1].strip().rstrip(";"))


def load_pack():
    sites = _read_js(SITES_JS, "MARKETINTEL")
    products = _read_js(PRODUCTS_JS, "MARKETINTEL_PRODUCTS")
    return sites, products


def save_pack(sites, products, stamp):
    os.makedirs(HISTORY, exist_ok=True)
    tag = stamp["as_of"]
    for src, name in ((SITES_JS, "sites"), (PRODUCTS_JS, "products")):
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(HISTORY, f"{name}.{tag}.js"))
    # ONE stamp, both files — the dashboard can no longer show two pull weeks.
    sites["meta"].update(stamp)
    products["meta"].update(stamp)
    open(SITES_JS, "w").write(
        "window.MARKETINTEL = " + json.dumps(sites, separators=(",", ":")) + ";\n")
    open(PRODUCTS_JS, "w").write(
        "window.MARKETINTEL_PRODUCTS = " + json.dumps(products, separators=(",", ":")) + ";\n")
    print(f"wrote {SITES_JS}\nwrote {PRODUCTS_JS}\nhistory snapshot -> {HISTORY}/*.{tag}.js")


# ---------------------------------------------------------------- normalise

def site_id(platform, account, loc):
    return f"{platform}:{account}:{loc}"


def norm_iclasspro(rec):
    """One probe result + its classes/tuition, as emitted by iclasspro.py."""
    out = []
    tui = rec.get("tuition") or {}
    for loc in rec.get("locations") or []:
        cls = [c for c in (rec.get("classes") or [])
               if not loc.get("id") or c.get("locationId") in (None, loc["id"])]
        openings = [c.get("openings") for c in cls if isinstance(c.get("openings"), int)]
        seats = rec.get("seat_model") or {}
        enrolled = seats.get("enrolled")           # from the brand seat table, or None
        out.append({
            "id": site_id("iclasspro", rec["account"], loc.get("id") or 1),
            "platform": "iclasspro",
            "account": rec["account"],
            "name": loc.get("name") or rec["account"],
            "brand": rec.get("brand") or loc.get("name") or rec["account"],
            "city": loc.get("city"), "state": loc.get("state"), "zip": loc.get("zip"),
            "phone": loc.get("phone"), "street": loc.get("street"),
            "lat": loc.get("lat"), "lng": loc.get("lng"),
            "n_classes": len(cls),
            "openings_total": sum(openings) if openings else None,
            "capacity": seats.get("capacity"),
            "enrolled": enrolled,
            "price_low": tui.get("monthly_median"),
            "price_unit": "per_month" if tui.get("monthly_median") else None,
            "billing_model": "perpetual_monthly" if tui.get("monthly_median") else "unknown",
            "revenue_rollable": bool(tui.get("monthly_median") and enrolled),
            "revenue_unit": "per_enrollee_month" if tui.get("monthly_median") else None,
            "evidence_tier": "derived" if enrolled is not None else "price_only",
            "account_state": rec.get("state"),
        })
    return out


def norm_jackrabbit(rec):
    """One org (optionally one loc= code) as emitted by jackrabbit.summarise()."""
    return [{
        "id": site_id("jackrabbit", rec["org"], rec.get("loc") or "ALL"),
        "platform": "jackrabbit",
        "account": str(rec["org"]),
        "name": rec.get("name") or f"JR org {rec['org']}",
        "brand": rec.get("brand") or rec.get("name"),
        "city": rec.get("city"), "state": rec.get("state"), "zip": rec.get("zip"),
        "lat": rec.get("lat"), "lng": rec.get("lng"),
        "n_classes": rec.get("n_classes"),
        "capacity": rec.get("derived_capacity"),
        "enrolled": rec.get("enrolled"),
        "price_low": rec.get("tuition_median"),
        "price_unit": rec.get("price_unit") or "per_month",
        "billing_model": rec.get("billing_model") or "unknown",
        "revenue_rollable": bool(rec.get("tuition_median") and rec.get("enrolled")),
        "revenue_unit": "per_enrollee_month" if rec.get("tuition_median") else None,
        "evidence_tier": "observed_max_only",
    }]


def norm_pike13(rec):
    """One subdomain as emitted by pike13.pull()."""
    return [{
        "id": site_id("pike13", rec["subdomain"], "1"),
        "platform": "pike13",
        "account": rec["subdomain"],
        "name": rec.get("name") or rec["subdomain"],
        "brand": rec.get("brand") or rec.get("name") or rec["subdomain"],
        "city": rec.get("city"), "state": rec.get("state"), "zip": rec.get("zip"),
        "lat": rec.get("lat"), "lng": rec.get("lng"),
        "n_classes": rec.get("n_classes"),
        "capacity": rec.get("capacity"),
        "enrolled": rec.get("enrolled"),
        "fill_pct": rec.get("fill_pct"),
        "price_low": rec.get("per_lesson_median"),
        "price_unit": "per_lesson",
        "billing_model": "one_off_per_lesson",
        # Per-lesson pricing is NOT monthly revenue. Never roll it up. (METHOD.md)
        "revenue_rollable": False,
        "revenue_unit": "per_lesson",
        "evidence_tier": "published",
    }]


NORMALISERS = {
    "iclasspro": ("accounts", norm_iclasspro),
    "jackrabbit": ("orgs", norm_jackrabbit),
    "pike13": ("sites", norm_pike13),
}


def load_pull(pull_dir):
    rows = []
    for plat, (key, fn) in NORMALISERS.items():
        path = os.path.join(pull_dir, f"{plat}.json")
        if not os.path.exists(path):
            continue
        doc = json.load(open(path))
        for rec in doc.get(key, []):
            rows.extend(fn(rec))
        print(f"  {plat:11} {len(doc.get(key, []))} records")
    return rows


# ---------------------------------------------------------------- dedupe

def _slug(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def dedupe(new_rows, existing):
    """Two passes: exact site_id, then geographic+name proximity.

    The second pass matters because the same business can arrive from two
    platforms (a franchise on Unleashed AND its own iClassPro account), and a
    dashboard that counts it twice inflates every metro total.
    """
    by_id = {s.get("id"): s for s in existing}
    geo = [(s, s.get("lat"), s.get("lng")) for s in existing if s.get("lat") and s.get("lng")]
    adds, updates, collisions = [], [], []
    for r in new_rows:
        if r["id"] in by_id:
            updates.append(r)
            continue
        hit = None
        if r.get("lat") and r.get("lng"):
            for s, la, ln in geo:
                if haversine(r["lat"], r["lng"], la, ln) <= DUPE_KM:
                    a, b = _slug(r.get("name")), _slug(s.get("name"))
                    if a and b and (a in b or b in a):
                        hit = s
                        break
        if hit:
            collisions.append((r, hit))
        else:
            adds.append(r)
    return adds, updates, collisions


# ---------------------------------------------------------------- enrich

def enrich(rows):
    """Metro + provenance. Never invents coordinates — geo.py does that upstream."""
    no_geo = 0
    for r in rows:
        m, d = assign_metro(r.get("lat"), r.get("lng"))
        r["metro"] = m
        r["metro_distance_km"] = d
        r["geo_precision"] = r.get("geo_precision") or ("location" if r.get("lat") else None)
        if not r.get("lat"):
            no_geo += 1
        r["revenue_eligible"] = bool(r.get("revenue_rollable"))
        r["is_junk"] = False
        r["likely_closed"] = r.get("account_state") == "frozen"
    if no_geo:
        print(f"  ! {no_geo} folded sites have no coordinates — run geo.py before folding, "
              f"or they will be invisible on the map and in every metro count")
    return rows


# ---------------------------------------------------------------- verify

def verify(sites, products):
    """Assertions that have each caught a real bug. Fold refuses to write on failure."""
    errs = []
    snap = sites["snapshots"][0]
    rows = snap["sites"]

    ids = [s.get("id") for s in rows]
    if len(ids) != len(set(ids)):
        d = [k for k, v in Counter(ids).items() if v > 1][:5]
        errs.append(f"duplicate site ids: {d}")

    if sites["meta"].get("week") != products["meta"].get("week"):
        errs.append(f"pull-week mismatch: sites={sites['meta'].get('week')} "
                    f"products={products['meta'].get('week')}")

    n_meta = sites["meta"].get("n_sites")
    if n_meta is not None and n_meta != len(rows):
        errs.append(f"meta.n_sites {n_meta} != {len(rows)} rows")

    # METHOD.md §5 — repeated values are a bug signal.
    coords = Counter((s.get("lat"), s.get("lng")) for s in rows if s.get("lat"))
    for c, n in coords.most_common(3):
        if n >= 25:
            errs.append(f"{n} sites share coordinates {c} — geocoding collapsed")

    for s in rows:
        if s.get("revenue_rollable") and s.get("revenue_unit") == "per_lesson":
            errs.append(f"{s.get('id')} is per_lesson AND revenue_rollable — never annualise this")
            break
        t = s.get("evidence_tier")
        if t and t not in TIERS:
            errs.append(f"{s.get('id')} unknown evidence_tier {t!r}")
            break

    prods = products.get("products", [])
    pm = products.get("meta", {})
    if pm.get("n_skus") not in (None, len(prods)):
        errs.append(f"products meta.n_skus {pm['n_skus']} != {len(prods)} rows")
    tiers = pm.get("evidence_tiers") or {}
    if tiers and sum(tiers.values()) != len(prods):
        errs.append(f"evidence_tiers sum {sum(tiers.values())} != {len(prods)} products")

    return errs


# ---------------------------------------------------------------- commands

def build_stamp(pull_dir):
    today = datetime.date.today()
    mon = today - datetime.timedelta(days=today.weekday())
    return {
        "as_of": today.isoformat(),
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "week": {"from": mon.isoformat(), "to": (mon + datetime.timedelta(days=6)).isoformat()},
        "pull_dir": os.path.basename(pull_dir.rstrip("/")) if pull_dir else None,
    }


def cmd_plan(args, write=False):
    sites, products = load_pack()
    rows = sites["snapshots"][0]["sites"]
    print(f"current pack: {len(rows)} sites · {len(products.get('products', []))} products\n")
    print("reading pull:")
    new = enrich(load_pull(args.pull))
    adds, updates, collisions = dedupe(new, rows)

    print(f"\n  + {len(adds):4} new sites")
    print(f"  ~ {len(updates):4} updates to existing sites")
    print(f"  = {len(collisions):4} suppressed as duplicates of an existing business")
    by_metro = Counter(a.get("metro") or "(unplaced)" for a in adds)
    if by_metro:
        print("\n  new sites by metro:")
        for m, n in by_metro.most_common(15):
            print(f"    {m[:26]:26} +{n}")
    plat = Counter(a["platform"] for a in adds)
    print(f"\n  by platform: {dict(plat)}")
    for r, hit in collisions[:5]:
        print(f"    dup: {r['id']}  ==  {hit.get('id')}  ({hit.get('name')})")

    if not write:
        print("\n(plan only — re-run with `apply --write` to change the pack)")
        return

    by_id = {s.get("id"): s for s in rows}
    for u in updates:
        by_id[u["id"]].update({k: v for k, v in u.items() if v is not None})
    rows.extend(adds)

    stamp = build_stamp(args.pull)
    snap = sites["snapshots"][0]
    snap["as_of"] = stamp["as_of"]
    snap["week_start"], snap["week_end"] = stamp["week"]["from"], stamp["week"]["to"]
    sites["meta"]["n_sites"] = len(rows)

    errs = verify(sites, products)
    if errs:
        print("\nREFUSING TO WRITE — verification failed:")
        for e in errs:
            print("  ✗", e)
        sys.exit(1)
    save_pack(sites, products, stamp)
    print(f"\nfolded {len(adds)} sites — pack now {len(rows)}")


def cmd_verify(args):
    sites, products = load_pack()
    errs = verify(sites, products)
    if errs:
        for e in errs:
            print("✗", e)
        sys.exit(1)
    print(f"✓ pack verified — {len(sites['snapshots'][0]['sites'])} sites, "
          f"{len(products.get('products', []))} products, one build stamp")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan");  p.add_argument("--pull", required=True)
    p.set_defaults(fn=lambda a: cmd_plan(a, write=False))
    a_ = sub.add_parser("apply"); a_.add_argument("--pull", required=True)
    a_.add_argument("--write", action="store_true")
    a_.set_defaults(fn=lambda a: cmd_plan(a, write=a.write))
    v = sub.add_parser("verify"); v.set_defaults(fn=cmd_verify)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
